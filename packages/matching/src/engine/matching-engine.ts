import { db } from "../db";
import { rides, drivers, vehicles } from "../db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export interface DriverMatch {
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleType: string;
  distance: number;
  estimatedTime: number;
  direction: string; // "NORTH", "SOUTH", "EAST", "WEST" or similar
}

export interface MatchingResult {
  rideId: string;
  matchedDriverId: string;
  match: DriverMatch;
}

export function findNearbyDrivers(
  passengerLat: number,
  passengerLng: number,
  vehicleType: "car" | "motorcycle" = "car",
  maxDistanceKm: number = 10
) {
  // In a real implementation, this would use PostGIS or a geospatial query
  // For MVP, we'll query all active drivers and filter client-side
  return db.select().from(drivers).where(eq(drivers.status, "online"));
}

export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  // Haversine formula
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

export function matchDriverWithRide(
  rideId: string,
  passengerLat: number,
  passengerLng: number
): MatchingResult | null {
  // Get the ride details
  const ride = db.select().from(rides).where(eq(rides.id, rideId));

  if (ride.length === 0) {
    return null;
  }

  // Get available drivers with vehicles
  const availableDrivers = db.select({
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

    // Filter by vehicle type if needed
    if (vehicle.vehicleType !== "car" && vehicle.vehicleType !== "motorcycle") {
      continue;
    }

    // Calculate distance between passenger and driver
    const distance = calculateDistance(
      passengerLat,
      passengerLng,
      Number(driver.currentLocationLat),
      Number(driver.currentLocationLng)
    );

    // Filter by max distance
    if (distance > 10) continue; // 10km max

    // Prefer closer drivers and those with matching vehicle type
    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = {
        driverId: driver.id,
        driverName: driver.user?.name || "Motorista",
        vehicleId: vehicle.id,
        vehiclePlate: vehicle.plate,
        vehicleType: vehicle.vehicleType,
        distance,
        estimatedTime: Math.round(distance * 2), // approx 2 min per km
        direction: "approaching",
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  // Record the match
  // In a real system, we'd update the ride status to DRIVER_ASSIGNED

  return {
    rideId,
    matchedDriverId: bestMatch.driverId,
    match: bestMatch,
  };
}

export function generateDriverId(): string {
  return uuidv4();
}