import { Router } from "express";
import { db, emergency_reserves, reserve_transactions } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { reserveEngine } from "./engine/reserve-engine";

const router = Router();

// Get driver's emergency reserve
router.get("/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params as { driverId: string };

    const reserve = await reserveEngine.getReserve(driverId);

    if (!reserve) {
      return res.status(404).json({ error: "Reserve not found" });
    }

    // Initialize if not exists
    const initialized = await reserveEngine.initializeReserve(driverId);

    return res.json({
      totalReserve: Number(initialized?.total_reserve) || 0,
      fuelReserve: Number(initialized?.fuel_reserve) || 0,
      maintenanceReserve: Number(initialized?.maintenance_reserve) || 0,
      accidentReserve: Number(initialized?.accident_reserve) || 0,
      mechanicalReserve: Number(initialized?.mechanical_reserve) || 0,
      periodWithoutWorkReserve: Number(initialized?.period_without_work_reserve) || 0,
      emergencyUsage: Number(initialized?.emergency_usage) || 0,
      isLocked: initialized?.is_locked || false,
    });
  } catch (error) {
    console.error("Get reserve error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Contribute to reserve
router.post("/:driverId/contribute", async (req, res) => {
  try {
    const { driverId } = req.params as { driverId: string };
    const { amount, purpose } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const result = await reserveEngine.contributeToReserve(driverId, amount, purpose || "emergency");

    return res.json({
      totalReserve: Number(result?.total_reserve) || 0,
      fuelReserve: Number(result?.fuel_reserve) || 0,
      maintenanceReserve: Number(result?.maintenance_reserve) || 0,
      accidentReserve: Number(result?.accident_reserve) || 0,
      mechanicalReserve: Number(result?.mechanical_reserve) || 0,
      periodWithoutWorkReserve: Number(result?.period_without_work_reserve) || 0,
      emergencyUsage: Number(result?.emergency_usage) || 0,
    });
  } catch (error) {
    console.error("Contribute to reserve error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Payout from reserve
router.post("/:driverId/payout", async (req, res) => {
  try {
    const { driverId } = req.params as { driverId: string };
    const { amount, purpose } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const result = await reserveEngine.payoutFromReserve(driverId, amount, purpose || "emergency");

    return res.json({
      totalReserve: Number(result?.total_reserve) || 0,
      emergencyUsage: Number(result?.emergency_usage) || 0,
    });
  } catch (error) {
    console.error("Payout from reserve error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get reserve transaction history
router.get("/:driverId/transactions", async (req, res) => {
  try {
    const { driverId } = req.params as { driverId: string };

    const { desc } = await import("drizzle-orm");
    const transactions = await db.select().from(reserve_transactions).where(
      eq(reserve_transactions.reserveId, driverId)
    ).orderBy(desc(reserve_transactions.created_at));

    return res.json(transactions);
  } catch (error) {
    console.error("Get reserve transactions error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const reserveRouter = router;
