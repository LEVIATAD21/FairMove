import { Router } from "express";
import { db } from "../db";
import { users, profiles, drivers } from "../db/schema";
import { eq } from "drizzle-orm";
import { sign, verify } from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// Get current user profile
router.get("/me", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header required" });
    }

    const token = authHeader.split(" ")[1];

    const decoded = verify(token, process.env.JWT_SECRET!) as { userId: string };

    const user = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.id, decoded.userId));

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const profile = await db.select().from(profiles).where(eq(profiles.userId, decoded.userId));

    const driver = await db.select().from(drivers).where(eq(drivers.userId, decoded.userId));

    return res.json({
      user: user[0],
      profile: profile[0] || null,
      driver: driver[0] || null,
    });
  } catch (error) {
    console.error("Get user profile error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Update profile
router.put("/profile", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header required" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verify(token, process.env.JWT_SECRET!) as { userId: string };

    const { phone, documentNumber, documentType, documentUrl } = req.body;

    let profile = await db.select().from(profiles).where(eq(profiles.userId, decoded.userId));

    if (profile.length > 0) {
      await db.update(profiles).set({
        phone,
        documentNumber,
        documentType,
        documentUrl,
        updatedAt: new Date(),
      }).where(eq(profiles.userId, decoded.userId));
    } else {
      await db.insert(profiles).values({
        userId: decoded.userId,
        phone,
        documentNumber,
        documentType,
        documentUrl,
      });
    }

    const user = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.id, decoded.userId));

    return res.json({ user: user[0] });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Driver onboarding
router.post("/driver/onboard", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header required" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verify(token, process.env.JWT_SECRET!) as { userId: string };

    const { plate, brand, model, year, vehicleType } = req.body;

    if (!plate || !brand || !model || !year || !vehicleType) {
      return res.status(400).json({ error: "Plate, brand, model, year and vehicleType are required" });
    }

    // Check if user already has a driver profile
    const existingDriver = await db.select().from(drivers).where(eq(drivers.userId, decoded.userId));

    if (existingDriver.length > 0) {
      return res.status(409).json({ error: "Driver profile already exists" });
    }

    // Check if vehicle already exists
    const existingVehicle = await db.select().from(vehicles).where(eq(vehicles.plate, plate));

    if (existingVehicle.length > 0) {
      return res.status(409).json({ error: "Vehicle plate already registered" });
    }

    const driverId = uuidv4();
    const vehicleId = uuidv4();

    // Create vehicle first
    await db.insert(vehicles).values({
      id: vehicleId,
      driverId, // This might cause issue - let's reconsider
      brand,
      model,
      year,
      plate,
      vehicleType,
      status: "available",
    });

    // Create driver profile
    await db.insert(drivers).values({
      id: driverId,
      userId: decoded.userId,
      vehicleId,
      status: "online",
      available: true,
      earnedToday: 0,
      pendingBalance: 0,
      reserveBalance: 0,
      subscriptionStatus: "free",
    });

    return res.status(201).json({ message: "Driver onboarded successfully" });
  } catch (error) {
    console.error("Driver onboarding error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const usersRouter = router;