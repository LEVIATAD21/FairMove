/**
 * Expiração de corridas presas (BUG-E4).
 *
 * A máquina de estados já previa REQUESTED/SEARCHING → EXPIRED, mas NADA no
 * código setava EXPIRED: sem job de timeout, uma corrida abandonada ficava
 * ativa para sempre — e o guard de "corrida ativa única" (409) bloqueava a
 * conta do passageiro para sempre.
 *
 * Este sweep roda em cron (backend) e também é chamável diretamente (testes).
 * TTL configurável via RIDE_EXPIRY_TTL_MINUTES (padrão 15).
 */
import { db, rides } from "@fairmove/shared-db";
import { and, eq, inArray, lt } from "drizzle-orm";
import { releaseRedemptions } from "../../promotions/src/engine/promotion-engine";
import { eventPublisher } from "../../realtime/src/redis/publisher";
import { recordRideEvent } from "./routes";

export const DEFAULT_RIDE_EXPIRY_TTL_MINUTES = 15;

const EXPIRABLE_STATUSES = ["REQUESTED", "SEARCHING"] as const;

export function rideExpiryTtlMinutes(): number {
  const raw = Number(process.env.RIDE_EXPIRY_TTL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RIDE_EXPIRY_TTL_MINUTES;
}

/**
 * Expira corridas REQUESTED/SEARCHING paradas além do TTL.
 * Reclama cada corrida com CAS (só uma varredura vence) e devolve cupons.
 * Retorna o número de corridas expiradas.
 */
export async function expireStaleRides(opts?: { now?: Date }): Promise<number> {
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - rideExpiryTtlMinutes() * 60_000);

  const stale = await db
    .select({
      id: rides.id,
      status: rides.status,
      passengerId: rides.passengerId,
      pickupLocationLat: rides.pickupLocationLat,
      pickupLocationLng: rides.pickupLocationLng,
    })
    .from(rides)
    .where(and(inArray(rides.status, [...EXPIRABLE_STATUSES]), lt(rides.createdAt, cutoff)));

  let expired = 0;
  for (const ride of stale) {
    const claimed = await db
      .update(rides)
      .set({ status: "EXPIRED", updatedAt: new Date() })
      .where(and(eq(rides.id, ride.id), inArray(rides.status, [...EXPIRABLE_STATUSES])))
      .returning({ id: rides.id });
    if (claimed.length === 0) continue;
    expired += 1;

    try {
      await releaseRedemptions(ride.id);
    } catch (error) {
      console.error(
        "RideExpiry: release redemptions error:",
        error instanceof Error ? error.message : String(error)
      );
    }

    try {
      await recordRideEvent(ride.id, "EXPIRED", ride.pickupLocationLat, ride.pickupLocationLng, {
        from: ride.status,
        ttlMinutes: rideExpiryTtlMinutes(),
      });
      await eventPublisher.publishRideStatusChanged({
        rideId: ride.id,
        status: "EXPIRED",
        from: ride.status,
        passengerId: ride.passengerId,
        driverId: null,
      });
    } catch (error) {
      console.error(
        "RideExpiry: event error:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return expired;
}
