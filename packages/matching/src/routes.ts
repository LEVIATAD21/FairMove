import { Router, type Request, type Response } from "express";
import { db, rides, drivers } from "@fairmove/shared-db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../../auth/src/middleware";
import { validateBody, validateQuery, LatSchema, LngSchema } from "@fairmove/validation";
import {
  findNearbyDrivers,
  matchDriverWithRide,
  updateDriverLocation,
  DEFAULT_MAX_DISTANCE_KM,
} from "./engine/matching-engine";

const router = Router();

const NearbyQuerySchema = z.object({
  lat: LatSchema,
  lng: LngSchema,
  radiusKm: z.coerce.number().positive().max(100).optional(),
  vehicleType: z.enum(["car", "motorcycle"]).optional(),
});

const DriverLocationSchema = z.object({ lat: LatSchema, lng: LngSchema });

const DriverStatusSchema = z.object({
  status: z.enum(["online", "offline", "on_trip"]),
  available: z.boolean().optional(),
});

// Solicita o match de motoristas para a corrida (passageiro dono da corrida)
router.post("/:rideId/match", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rideId } = req.params as { rideId: string };

    const ride = await db.select().from(rides).where(eq(rides.id, rideId));
    if (ride.length === 0) {
      res.status(404).json({ error: "Ride not found" });
      return;
    }

    if (ride[0].passengerId !== req.user!.id && req.user!.role !== "admin") {
      res.status(403).json({ error: "Ride does not belong to this user" });
      return;
    }

    if (!["REQUESTED", "SEARCHING"].includes(ride[0].status)) {
      res.status(400).json({ error: "Ride cannot be matched in current status" });
      return;
    }

    // REQUESTED -> SEARCHING (transição atômica; outro request pode ter feito já)
    if (ride[0].status === "REQUESTED") {
      const updated = await db
        .update(rides)
        .set({ status: "SEARCHING", updatedAt: new Date() })
        .where(and(eq(rides.id, rideId), eq(rides.status, "REQUESTED")))
        .returning({ id: rides.id });
      if (updated.length === 0) {
        res.status(409).json({ error: "Ride state changed concurrently" });
        return;
      }
    }

    const pickupLat = Number(ride[0].pickupLocationLat);
    const pickupLng = Number(ride[0].pickupLocationLng);

    const match = await matchDriverWithRide(
      rideId,
      pickupLat,
      pickupLng,
      undefined,
      DEFAULT_MAX_DISTANCE_KM
    );

    res.json({
      rideId,
      status: "SEARCHING",
      matched: Boolean(match),
      match,
    });
  } catch (error) {
    console.error("Match driver error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Lista motoristas próximos (raio configurável)
router.get(
  "/drivers/nearby",
  requireAuth,
  validateQuery(NearbyQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const { lat, lng, radiusKm, vehicleType } = req.query as unknown as z.infer<
        typeof NearbyQuerySchema
      >;

      const nearbyDrivers = await findNearbyDrivers(
        lat,
        lng,
        vehicleType,
        radiusKm ?? DEFAULT_MAX_DISTANCE_KM
      );

      res.json({ drivers: nearbyDrivers });
    } catch (error) {
      console.error("Get nearby drivers error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Motorista atualiza a própria localização
router.post(
  "/driver/location",
  requireRole("driver", "admin"),
  validateBody(DriverLocationSchema),
  async (req: Request, res: Response) => {
    try {
      const { lat, lng } = req.body as { lat: number; lng: number };

      const driver = await db.select().from(drivers).where(eq(drivers.userId, req.user!.id));
      if (driver.length === 0) {
        res.status(404).json({ error: "Driver profile not found" });
        return;
      }

      await updateDriverLocation(driver[0].id, lat, lng);

      res.json({ driverId: driver[0].id, lat, lng });
    } catch (error) {
      console.error("Update driver location error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Motorista fica online/offline
router.post(
  "/driver/status",
  requireRole("driver", "admin"),
  validateBody(DriverStatusSchema),
  async (req: Request, res: Response) => {
    try {
      const { status, available } = req.body as { status: string; available?: boolean };

      const driver = await db.select().from(drivers).where(eq(drivers.userId, req.user!.id));
      if (driver.length === 0) {
        res.status(404).json({ error: "Driver profile not found" });
        return;
      }

      const patch: Record<string, unknown> = { status, updated_at: new Date() };
      if (available !== undefined) patch.available = available;
      if (status === "offline") patch.available = false;

      await db.update(drivers).set(patch).where(eq(drivers.id, driver[0].id));

      res.json({ driverId: driver[0].id, status, available: patch.available ?? driver[0].available });
    } catch (error) {
      console.error("Update driver status error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export const matchingRouter = router;
