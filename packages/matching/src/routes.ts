import { Router } from "express";
import { db } from "../db";
import { rides, drivers, users } from "../db/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

// Request driver match for a ride
router.post("/:rideId/match", async (req, res) => {
  try {
    const { rideId } = req.params;

    const ride = db.select().from(rides).where(eq(rides.id, rideId));

    if (ride.length === 0) {
      return res.status(404).json({ error: "Ride not found" });
    }

    // Check ride is in a state that can be matched
    if (!["REQUESTED", "SEARCHING"].includes(ride[0].status)) {
      return res.status(400).json({ error: "Ride cannot be matched in current status" });
    }

    // Get available drivers
    const availableDrivers = db.select({
      driver: drivers,
      vehicle: vehicles,
    }).from(drivers)
      .leftJoin(vehicles, eq(drivers.id, vehicles.driverId))
      .where(and(
        eq(drivers.status, "online"),
        eq(drivers.available, true),
      ));

    return res.json({ rideId, status: "matched", drivers: availableDrivers });
  } catch (error) {
    console.error("Match driver error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get nearby drivers (requires lat/lng query params)
router.get("/drivers/nearby", async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "Latitude and longitude are required" });
    }

    const drivers = db.select({
      driver: drivers,
      vehicle: vehicles,
    }).from(drivers)
      .leftJoin(vehicles, eq(drivers.id, vehicles.driverId))
      .where(and(
        eq(drivers.status, "online"),
        eq(drivers.available, true),
      ));

    return res.json({ drivers: availableDrivers });
  } catch (error) {
    console.error("Get nearby drivers error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const matchingRouter = router;