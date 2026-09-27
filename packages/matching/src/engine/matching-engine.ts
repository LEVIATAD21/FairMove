import { db, drivers, vehicles, users } from "@fairmove/shared-db";
import { eq, and, sql } from "drizzle-orm";

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

/** Point geography (WGS84) — base de todas as métricas do matching. */
function pointGeography(lng: number, lat: number) {
  return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
}

/**
 * Localização do motorista como point geography.
 * O CASE garante cast seguro: coordenada inválida vira NULL e a linha é
 * descartada pela predicate ST_DWithin (NULL nunca satisfaz WHERE).
 */
function driverPointGeography() {
  return sql`ST_SetSRID(ST_MakePoint(
    CASE WHEN ${drivers.currentLocationLng} ~ '^-?[0-9]+(\.[0-9]+)?$' THEN ${drivers.currentLocationLng}::float8 ELSE NULL END,
    CASE WHEN ${drivers.currentLocationLat} ~ '^-?[0-9]+(\.[0-9]+)?$' THEN ${drivers.currentLocationLat}::float8 ELSE NULL END
  ), 4326)::geography`;
}

interface DriverCandidate {
  driver: typeof drivers.$inferSelect;
  vehicle: typeof vehicles.$inferSelect | null;
  user: typeof users.$inferSelect | null;
}

/**
 * Motorista elegível: online, disponível, veículo compatível e dentro do
 * raio de busca (distância medida pelo PostGIS, não por JS).
 */
function buildCandidate(
  candidate: DriverCandidate,
  distanceMeters: number,
  vehicleType: "car" | "motorcycle" | undefined
): NearbyDriver | null {
  const { driver, vehicle, user } = candidate;

  if (!vehicle) return null;
  if (vehicleType && vehicle.vehicleType !== vehicleType) return null;
  if (!Number.isFinite(distanceMeters)) return null;

  const distanceKm = distanceMeters / 1000;

  return {
    driverId: driver.id,
    driverUserId: driver.userId,
    driverName: user?.name || "Motorista",
    vehicleId: vehicle.id,
    vehiclePlate: vehicle.plate,
    vehicleType: vehicle.vehicleType,
    distance: Math.round(distanceKm * 100) / 100,
    estimatedTime: Math.max(1, Math.round(distanceKm * 2)),
    direction: "approaching",
    status: driver.status,
  };
}

/**
 * Lista motoristas próximos, ordenados pela distância.
 * Matching geoespacial 100% no PostGIS: ST_DWithin no filtro (com índice)
 * e ST_DDistance na ordenação, em geography (metros, elipsoidal WGS84).
 */
export async function findNearbyDrivers(
  passengerLat: number,
  passengerLng: number,
  vehicleType?: "car" | "motorcycle",
  maxDistanceKm: number = DEFAULT_MAX_DISTANCE_KM
): Promise<NearbyDriver[]> {
  if (
    !Number.isFinite(passengerLat) ||
    !Number.isFinite(passengerLng) ||
    passengerLat < -90 ||
    passengerLat > 90 ||
    passengerLng < -180 ||
    passengerLng > 180
  ) {
    return [];
  }

  const radiusMeters = maxDistanceKm * 1000;
  const pickup = pointGeography(passengerLng, passengerLat);

  const rows = await db
    .select({
      driver: drivers,
      vehicle: vehicles,
      user: users,
      distanceMeters: sql<string | null>`ST_Distance(${driverPointGeography()}, ${pickup})`,
    })
    .from(drivers)
    .leftJoin(vehicles, eq(drivers.vehicleId, vehicles.id))
    .leftJoin(users, eq(drivers.userId, users.id))
    .where(
      and(
        eq(drivers.status, "online"),
        eq(drivers.available, true),
        sql`ST_DWithin(${driverPointGeography()}, ${pickup}, ${radiusMeters})`
      )
    )
    .orderBy(sql`ST_Distance(${driverPointGeography()}, ${pickup})`);

  const matches = rows
    .map((row: DriverCandidate & { distanceMeters: string | null }) =>
      buildCandidate(row, Number(row.distanceMeters), vehicleType)
    )
    .filter((m: NearbyDriver | null): m is NearbyDriver => m !== null);

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
