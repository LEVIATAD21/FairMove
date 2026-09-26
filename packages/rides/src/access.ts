import { db, rides, drivers, type Ride } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import type { AuthUser } from "../../auth/src/middleware";

export async function getDriverByUserId(userId: string) {
  const rows = await db.select().from(drivers).where(eq(drivers.userId, userId));
  return rows.length > 0 ? rows[0] : null;
}

export async function loadRide(rideId: string): Promise<Ride | null> {
  const rows = await db.select().from(rides).where(eq(rides.id, rideId));
  return rows.length > 0 ? (rows[0] as Ride) : null;
}

export type RideAccess =
  | { ok: true; ride: Ride }
  | { ok: false; status: number; message: string };

/** Carrega a corrida e valida que o usuário pode acessá-la (admin, passageiro ou motorista). */
export async function loadRideForUser(rideId: string, user: AuthUser): Promise<RideAccess> {
  const ride = await loadRide(rideId);
  if (!ride) return { ok: false, status: 404, message: "Ride not found" };

  if (user.role === "admin") return { ok: true, ride };

  if (ride.passengerId === user.id) return { ok: true, ride };

  if (ride.driverId) {
    const driver = await getDriverByUserId(user.id);
    if (driver && driver.id === ride.driverId) return { ok: true, ride };
  }

  return { ok: false, status: 403, message: "You do not have access to this ride" };
}

/**
 * Guarda de participação usada por rotas auxiliares (safety, fraud).
 * Retorna a corrida ou `null` (404/403 devem ser respondidos pelo caller).
 */
export async function canAccessRide(rideId: string, user: AuthUser): Promise<Ride | null> {
  const result = await loadRideForUser(rideId, user);
  return result.ok ? result.ride : null;
}
