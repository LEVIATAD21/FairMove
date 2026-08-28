import { Router } from "express";
import { db, rides, rideLocationEvents, users } from "@fairmove/shared-db";
import { eq, desc } from "drizzle-orm";
import { canTransition, transitionRide } from "./state/machine";
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
    const rideId = uuidv4();
    const status = "REQUESTED";

    await db.insert(rides).values({
      id: rideId,
      passengerId,
      status,
      pickupLocationLat: pickupLocationLat ? String(pickupLocationLat) : "0",
      pickupLocationLng: pickupLocationLng ? String(pickupLocationLng) : "0",
      dropoffLocationLat: dropoffLocationLat ? String(dropoffLocationLat) : "0",
      dropoffLocationLng: dropoffLocationLng ? String(dropoffLocationLng) : "0",
    });

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
    const { rideId } = req.params as { rideId: string };

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
    const { rideId } = req.params as { rideId: string };
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ error: "Driver ID is required" });
    }

    const ride = await db.select().from(rides).where(eq(rides.id, rideId));

    if (ride.length === 0) {
      return res.status(404).json({ error: "Ride not found" });
    }

    const currentStatus = ride[0].status;
    const result = transitionRide(currentStatus, "DRIVER_ASSIGNED");

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    await db.update(rides).set({
      status: "DRIVER_ASSIGNED",
      driverId,
    }).where(eq(rides.id, rideId));

    return res.json({ rideId, status: "DRIVER_ASSIGNED" });
  } catch (error) {
    console.error("Accept ride error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Complete ride
router.post("/:rideId/complete", async (req, res) => {
  try {
    const { rideId } = req.params as { rideId: string };
    const { driverId, totalFare } = req.body;

    if (!driverId || !totalFare) {
      return res.status(400).json({ error: "Driver ID and total fare are required" });
    }

    const ride = await db.select().from(rides).where(eq(rides.id, rideId));

    if (ride.length === 0) {
      return res.status(404).json({ error: "Ride not found" });
    }

    const currentStatus = ride[0].status;
    const result = transitionRide(currentStatus, "COMPLETED");

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    await db.update(rides).set({
      status: "COMPLETED",
      finalPassengerPrice: Math.round(totalFare * 100),
      driverCredit: Math.round(totalFare * 100),
    }).where(eq(rides.id, rideId));

    return res.json({ rideId, status: "COMPLETED" });
  } catch (error) {
    console.error("Complete ride error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Cancel ride
router.post("/:rideId/cancel", async (req, res) => {
  try {
    const { rideId } = req.params as { rideId: string };
    const { cancelledBy, reason } = req.body;

    if (!cancelledBy) {
      return res.status(400).json({ error: "Cancelled by is required" });
    }

    const ride = await db.select().from(rides).where(eq(rides.id, rideId));

    if (ride.length === 0) {
      return res.status(404).json({ error: "Ride not found" });
    }

    const currentStatus = ride[0].status;
    const cancelStatus = cancelledBy === "driver" ? "CANCELLED_BY_DRIVER" : "CANCELLED_BY_PASSENGER";
    const result = transitionRide(currentStatus, cancelStatus);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    await db.update(rides).set({
      status: cancelStatus,
      cancellationReason: reason || null,
    }).where(eq(rides.id, rideId));

    return res.json({ rideId, status: cancelStatus });
  } catch (error) {
    console.error("Cancel ride error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get ride history for user
router.get("/history/:userId", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };

    const rideHistory = await db.select().from(rides).where(
      eq(rides.passengerId, userId)
    ).orderBy(desc(rides.createdAt));

    return res.json(rideHistory);
  } catch (error) {
    console.error("Get ride history error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const rideRouter = router;
