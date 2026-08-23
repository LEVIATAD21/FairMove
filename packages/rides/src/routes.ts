import { Router } from "express";
import { db } from "../db";
import { rides, rideLocationEvents, users, drivers, vehicles } from "../db/schema";
import { eq } from "drizzle-orm";
import { rideStateMachine } from "../state/machine";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// Create ride request
router.post("/", async (req, res) => {
  try {
    const { passengerId, pickupLocationLat, pickupLocationLng, dropoffLocationLat, dropoffLocationLng } = req.body;

    if (!passengerId) {
      return res.status(400).json({ error: "Passenger ID is required" });
    }

    // Verify passenger exists
    const passenger = await db.select().from(users).where(eq(users.id, passengerId));

    if (passenger.length === 0) {
      return res.status(404).json({ error: "Passenger not found" });
    }

    // Create ride
    const { rideId, status } = await rideStateMachine.createRide(passengerId);

    // Record ride location event
    await db.insert(rideLocationEvents).values({
      rideId,
      eventType: "REQUESTED",
      lat: pickupLocationLat ? String(pickupLocationLat) : "0",
      lng: pickupLocationLng ? String(pickupLocationLng) : "0",
      metadata: JSON.stringify({ passengerId }),
    });

    return res.status(201).json({ rideId, status });
  } catch (error) {
    console.error("Create ride error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get ride by ID
router.get("/:rideId", async (req, res) => {
  try {
    const { rideId } = req.params;

    const ride = await db.select().from(rides).where(eq(rides.id, rideId));

    if (ride.length === 0) {
      return res.status(404).json({ error: "Ride not found" });
    }

    return res.json(ride[0]);
  } catch (error) {
    console.error("Get ride error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Accept ride (driver)
router.post("/:rideId/accept", async (req, res) => {
  try {
    const { rideId } = req.params;
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ error: "Driver ID is required" });
    }

    const result = await rideStateMachine.startRide(rideId, driverId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ rideId, status: result.rideStatus });
  } catch (error) {
    console.error("Accept ride error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Complete ride
router.post("/:rideId/complete", async (req, res) => {
  try {
    const { rideId } = req.params;
    const { driverId, totalFare } = req.body;

    if (!driverId || !totalFare) {
      return res.status(400).json({ error: "Driver ID and total fare are required" });
    }

    const result = await rideStateMachine.completeRide(rideId, driverId, totalFare);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ rideId, status: result.rideStatus });
  } catch (error) {
    console.error("Complete ride error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Cancel ride
router.post("/:rideId/cancel", async (req, res) => {
  try {
    const { rideId } = req.params;
    const { cancelledBy, reason } = req.body;

    if (!cancelledBy) {
      return res.status(400).json({ error: "Cancelled by is required" });
    }

    const result = await rideStateMachine.cancelRide(rideId, cancelledBy, reason);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ rideId, status: result.rideStatus });
  } catch (error) {
    console.error("Cancel ride error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get ride history for user
router.get("/history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const rideHistory = await db.select().from(rides).where(
      eq(rides.passengerId, userId)
    ).orderBy(rides.createdAt.desc());

    return res.json(rideHistory);
  } catch (error) {
    console.error("Get ride history error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const rideRouter = router;