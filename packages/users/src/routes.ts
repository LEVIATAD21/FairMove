import { Router, type Request, type Response } from "express";
import { db, users, profiles, drivers, vehicles, type Transaction } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "../../auth/src/middleware";
import { validateBody, ProfileUpdateSchema, DriverSchema } from "@fairmove/validation";

const router = Router();

// Get current user profile
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, req.user!.id));

    if (user.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const profile = await db.select().from(profiles).where(eq(profiles.userId, req.user!.id));
    const driver = await db.select().from(drivers).where(eq(drivers.userId, req.user!.id));

    res.json({
      user: user[0],
      profile: profile[0] || null,
      driver: driver[0] || null,
    });
  } catch (error) {
    console.error("Get user profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update profile (apenas campos próprios, validados)
router.put("/profile", requireAuth, validateBody(ProfileUpdateSchema), async (req: Request, res: Response) => {
  try {
    const { phone, documentNumber, documentType, documentUrl } = req.body as {
      phone?: string;
      documentNumber?: string;
      documentType?: string;
      documentUrl?: string;
    };

    const existing = await db.select().from(profiles).where(eq(profiles.userId, req.user!.id));

    if (existing.length > 0) {
      await db
        .update(profiles)
        .set({
          phone,
          documentNumber,
          documentType,
          documentUrl,
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, req.user!.id));
    } else {
      await db.insert(profiles).values({
        userId: req.user!.id,
        phone,
        documentNumber,
        documentType,
        documentUrl,
      });
    }

    const user = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, req.user!.id));

    res.json({ user: user[0] });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Driver onboarding (transação: usuário + veículo + motorista)
router.post(
  "/driver/onboard",
  requireAuth,
  validateBody(DriverSchema),
  async (req: Request, res: Response) => {
    try {
      const { plate, brand, model, year, color, vehicleType } = req.body as {
        plate: string;
        brand: string;
        model: string;
        year: number;
        color?: string;
        vehicleType: string;
      };

      const existingDriver = await db.select().from(drivers).where(eq(drivers.userId, req.user!.id));
      if (existingDriver.length > 0) {
        res.status(409).json({ error: "Driver profile already exists" });
        return;
      }

      const existingVehicle = await db.select().from(vehicles).where(eq(vehicles.plate, plate));
      if (existingVehicle.length > 0) {
        res.status(409).json({ error: "Vehicle plate already registered" });
        return;
      }

      const driverId = uuidv4();
      const vehicleId = uuidv4();
      const normalizedType = vehicleType.toLowerCase();

      await db.transaction(async (tx: Transaction) => {
        await tx.insert(vehicles).values({
          id: vehicleId,
          driverId,
          brand,
          model,
          year,
          color,
          plate,
          vehicleType: normalizedType,
          status: "available",
        });

        await tx.insert(drivers).values({
          id: driverId,
          userId: req.user!.id,
          vehicleId,
          status: "offline",
          available: true,
          earnedToday: 0,
          pendingBalance: 0,
          reserveBalance: 0,
          subscriptionStatus: "free",
        });

        // O dono da conta passa a poder operar como motorista
        await tx
          .update(users)
          .set({ role: "driver", updatedAt: new Date() })
          .where(eq(users.id, req.user!.id));
      });

      res.status(201).json({ message: "Driver onboarded successfully", driverId, vehicleId });
    } catch (error) {
      console.error("Driver onboarding error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Localização/perfil do motorista autenticado
router.get("/driver/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const driver = await db.select().from(drivers).where(eq(drivers.userId, req.user!.id));
    if (driver.length === 0) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }
    const vehicle = driver[0].vehicleId
      ? await db.select().from(vehicles).where(eq(vehicles.id, driver[0].vehicleId))
      : [];
    res.json({ driver: driver[0], vehicle: vehicle[0] || null });
  } catch (error) {
    console.error("Get driver profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export const usersRouter = router;
