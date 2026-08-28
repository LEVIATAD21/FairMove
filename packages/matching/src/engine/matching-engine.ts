import { db, rides, drivers, vehicles } from "@fairmove/shared-db";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export interface DriverMatch {
  driverId: string;
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

export async function findNearbyDrivers(
  passengerLat: number,
  passengerLng: number,
  vehicleType: "car" | "motorcycle" = "car",
  maxDistanceKm: number = 10
) {
  return db.select().from(drivers).where(eq(drivers.status, "online"));
}

export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

export async function matchDriverWithRide(
  rideId: string,
  passengerLat: number,
  passengerLng: number
): Promise<MatchingResult | null> {
  const ride = await db.select().from(rides).where(eq(rides.id, rideId));

  if (ride.length === 0) {
    return null;
  }

  const availableDrivers = await db.select({
    driver: drivers,
    vehicle: vehicles,
  }).from(drivers)
    .leftJoin(vehicles, eq(drivers.id, vehicles.driverId))
    .where(and(
      eq(drivers.status, "online"),
      eq(drivers.available, true),
    ));

  let bestMatch = null;
  let minDistance = Infinity;

  for (const { driver, vehicle } of availableDrivers) {
    if (!vehicle) continue;

    if (vehicle.vehicleType !== "car" && vehicle.vehicleType !== "motorcycle") {
      continue;
    }

    const distance = calculateDistance(
      passengerLat,
      passengerLng,
      Number(driver.currentLocationLat),
      Number(driver.currentLocationLng)
    );

    if (distance > 10) continue;

    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = {
        driverId: driver.id,
        driverName: "Motorista",
        vehicleId: vehicle.id,
        vehiclePlate: vehicle.plate,
        vehicleType: vehicle.vehicleType,
        distance,
        estimatedTime: Math.round(distance * 2),
        direction: "approaching",
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    rideId,
    matchedDriverId: bestMatch.driverId,
    match: bestMatch,
  };
}

export function generateDriverId(): string {
  return uuidv4();
}
