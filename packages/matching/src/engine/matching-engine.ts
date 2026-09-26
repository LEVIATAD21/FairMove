import { db, drivers, vehicles, users } from "@fairmove/shared-db";
import { eq, and, sql } from "drizzle-orm";
import { haversineKm, isValidLatitude, isValidLongitude } from "@fairmove/shared-types";

export interface DriverMatch {
  driverId: string;
  driverUserId: string;
  driverName: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleType: string;
  distance: number;
  estimatedTime: number;
  direction: string;
}

export interface MatchingResult {
  rideId: string;
  matchedDriverId: string;
  match: DriverMatch;
}

export interface NearbyDriver extends DriverMatch {
  status: string;
}

export const DEFAULT_MAX_DISTANCE_KM = 10;

/** Distância em km entre dois pontos (Haversine). */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  return haversineKm({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
}

interface DriverCandidate {
  driver: typeof drivers.$inferSelect;
  vehicle: typeof vehicles.$inferSelect | null;
  user: typeof users.$inferSelect | null;
}

/**
 * Motorista elegível: online, disponível, com localização conhecida,
 * veículo compatível e dentro do raio de busca.
 */
function buildCandidate(
  candidate: DriverCandidate,
  passengerLat: number,
  passengerLng: number,
  vehicleType: "car" | "motorcycle" | undefined,
  maxDistanceKm: number
): NearbyDriver | null {
  const { driver, vehicle, user } = candidate;

  if (!vehicle) return null;
  if (vehicleType && vehicle.vehicleType !== vehicleType) return null;
  if (!isValidLatitude(Number(driver.currentLocationLat))) return null;
  if (!isValidLongitude(Number(driver.currentLocationLng))) return null;

  const distance = calculateDistance(
    passengerLat,
    passengerLng,
    Number(driver.currentLocationLat),
    Number(driver.currentLocationLng)
  );

  if (!Number.isFinite(distance) || distance > maxDistanceKm) return null;

  return {
    driverId: driver.id,
    driverUserId: driver.userId,
    driverName: user?.name || "Motorista",
    vehicleId: vehicle.id,
    vehiclePlate: vehicle.plate,
    vehicleType: vehicle.vehicleType,
    distance: Math.round(distance * 100) / 100,
    estimatedTime: Math.max(1, Math.round(distance * 2)),
    direction: "approaching",
    status: driver.status,
  };
}

/** Lista motoristas próximos, ordenados pela distância. */
export async function findNearbyDrivers(
  passengerLat: number,
  passengerLng: number,
  vehicleType?: "car" | "motorcycle",
  maxDistanceKm: number = DEFAULT_MAX_DISTANCE_KM
): Promise<NearbyDriver[]> {
  if (!isValidLatitude(passengerLat) || !isValidLongitude(passengerLng)) {
    return [];
  }

  const rows = await db
    .select({ driver: drivers, vehicle: vehicles, user: users })
    .from(drivers)
    .leftJoin(vehicles, eq(drivers.vehicleId, vehicles.id))
    .leftJoin(users, eq(drivers.userId, users.id))
    .where(and(eq(drivers.status, "online"), eq(drivers.available, true)));

  const matches = rows
    .map((row: DriverCandidate) =>
      buildCandidate(row, passengerLat, passengerLng, vehicleType, maxDistanceKm)
    )
    .filter((m: NearbyDriver | null): m is NearbyDriver => m !== null)
    .sort((a: NearbyDriver, b: NearbyDriver) => a.distance - b.distance);

  return matches;
}

/** Escolhe o motorista disponível mais próximo da corrida. */
export async function matchDriverWithRide(
  rideId: string,
  passengerLat: number,
  passengerLng: number,
  vehicleType?: "car" | "motorcycle",
  maxDistanceKm: number = DEFAULT_MAX_DISTANCE_KM
): Promise<MatchingResult | null> {
  const candidates = await findNearbyDrivers(passengerLat, passengerLng, vehicleType, maxDistanceKm);
  if (candidates.length === 0) return null;

  const best = candidates[0];
  return {
    rideId,
    matchedDriverId: best.driverId,
    match: best,
  };
}

/** Marca o motorista como ocupado/ivre. */
export async function setDriverAvailability(
  driverId: string,
  available: boolean
): Promise<void> {
  await db
    .update(drivers)
    .set({ available, updatedAt: new Date() })
    .where(eq(drivers.id, driverId));
}

/** Atualiza a posição do motorista (aceita coordenadas em texto ou número). */
export async function updateDriverLocation(
  driverId: string,
  lat: number,
  lng: number
): Promise<void> {
  await db
    .update(drivers)
    .set({
      currentLocationLat: sql`${lat}::text`,
      currentLocationLng: sql`${lng}::text`,
      updatedAt: new Date(),
    })
    .where(eq(drivers.id, driverId));
}
