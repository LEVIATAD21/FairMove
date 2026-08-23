import { db } from "../db";
import { emergency_reserves, reserve_transactions, drivers } from "../db/schema";
import { eq } from "drizzle-orm";
import { walletEngine } from "../wallets/engine/wallet-engine";
import { v4 as uuidv4 } from "uuid";

export class ReserveEngine {
  constructor(private db = db, private walletEngine = walletEngine) {}

  async getReserve(driverId: string) {
    const reserve = db.select().from(emergency_reserves).where(
      eq(emergency_reserves.driverId, driverId)
    );
    return reserve.length > 0 ? reserve[0] : null;
  }

  async initializeReserve(driverId: string) {
    // Check if reserve already exists
    const existing = await this.getReserve(driverId);

    if (existing) {
      return existing;
    }

    // Create initial reserve - start with 0
    const id = uuidv4();
    await db.insert(emergency_reserves).values({
      id,
      driverId,
      total_reserve: 0,
      fuel_reserve: 0,
      maintenance_reserve: 0,
      accident_reserve: 0,
      mechanical_reserve: 0,
      period_without_work_reserve: 0,
      emergency_usage: 0,
      is_locked: false,
    });

    return this.getReserve(driverId);
  }

  async contributeToReserve(driverId: string, amount: number, purpose: string) {
    const amountInCents = Math.round(amount * 100);

    // Contribute to wallet reserve (integrated with wallet engine)
    const walletResult = await this.walletEngine.contributeToReserve(
      driverId,
      amount / 100, // convert to dollars for wallet engine
      purpose
    );

    // Update the emergency_reserves table
    const reserve = await this.getReserve(driverId);
    if (!reserve) {
      await this.initializeReserve(driverId);
    }

    const newReserve = Number(reserve?.total_reserve) || 0;
    const newTotal = newReserve + amountInCents;
    const newFuel = (Number(reserve?.fuel_reserve) || 0);
    const newMaintenance = (Number(reserve?.maintenance_reserve) || 0);
    const newAccident = (Number(reserve?.accident_reserve) || 0);
    const newMechanical = (Number(reserve?.mechanical_reserve) || 0);
    const newPeriodWithoutWork = (Number(reserve?.period_without_work_reserve) || 0);
    const newEmergencyUsage = (Number(reserve?.emergency_usage) || 0);

    // Allocate to specific category based on purpose
    let allocatedFuel = newFuel;
    let allocatedMaintenance = newMaintenance;
    let allocatedAccident = newAccident;
    let allocatedMechanical = newMechanical;
    let allocatedPeriodWithoutWork = newPeriodWithoutWork;
    let allocatedEmergencyUsage = newEmergencyUsage;

    const lowerPurpose = purpose.toLowerCase();
    if (lowerPurpose === "fuel") {
      allocatedFuel = newTotal;
    } else if (lowerPurpose === "maintenance") {
      allocatedMaintenance = newTotal;
    } else if (lowerPurpose === "accident") {
      allocatedAccident = newTotal;
    } else if (lowerPurpose === "mechanical") {
      allocatedMechanical = newTotal;
    } else if (lowerPurpose === "period without work") {
      allocatedPeriodWithoutWork = newTotal;
    } else if (lowerPurpose === "emergency") {
      allocatedEmergencyUsage = newTotal;
    } else {
      // Distribute proportionally or to emergency
      allocatedEmergencyUsage = newTotal;
    }

    // Update emergency_reserves
    await db.update(emergency_reserves).set({
      total_reserve: newTotal,
      fuel_reserve: allocatedFuel,
      maintenance_reserve: allocatedMaintenance,
      accident_reserve: allocatedAccident,
      mechanical_reserve: allocatedMechanical,
      period_without_work_reserve: allocatedPeriodWithoutWork,
      emergency_usage: allocatedEmergencyUsage,
      updated_at: new Date(),
    }).where(eq(emergency_reserves.driverId, driverId));

    // Record the reserve transaction
    await db.insert(reserve_transactions).values({
      id: uuidv4(),
      reserveId: uuidv4(),
      transactionId: uuidv4(),
      amount: amountInCents,
      currency: "BRL",
      purpose,
      direction: "contribution",
      status: "completed",
    });

    return this.getReserve(driverId);
  }

  async payoutFromReserve(driverId: string, amount: number, purpose: string) {
    const amountInCents = Math.round(amount * 100);

    // Get current reserve
    const reserve = await this.getReserve(driverId);
    if (!reserve) {
      throw new Error("Reserve not found");
    }

    const currentTotal = Number(reserve.total_reserve);
    if (currentTotal < amountInCents) {
      throw new Error("Insufficient reserve balance");
    }

    // Payout from wallet reserve (integrated with wallet engine)
    const walletResult = await this.walletEngine.payoutFromReserve(
      driverId,
      amount / 100, // convert to dollars
      purpose
    );

    // Update the emergency_reserves table
    const newTotal = currentTotal - amountInCents;
    const newFuel = Number(reserve.fuel_reserve) || 0;
    const newMaintenance = Number(reserve.maintenance_reserve) || 0;
    const newAccident = Number(reserve.accident_reserve) || 0;
    const newMechanical = Number(reserve.mechanical_reserve) || 0;
    const newPeriodWithoutWork = Number(reserve.period_without_work_reserve) || 0;
    const newEmergencyUsage = Number(reserve.emergency_usage) || 0;

    // Reduce from the appropriate category
    const lowerPurpose = purpose.toLowerCase();
    if (lowerPurpose === "fuel" && newFuel > 0) {
      // Reduce proportionally or from specific category
    }
    // For simplicity, reduce from total and emergency_usage
    const reducedEmergencyUsage = Math.max(0, newEmergencyUsage - amountInCents);

    // Update emergency_reserves
    await db.update(emergency_reserves).set({
      total_reserve: newTotal,
      emergency_usage: reducedEmergencyUsage,
      updated_at: new Date(),
    }).where(eq(emergency_reserves.driverId, driverId));

    // Record the reserve transaction
    await db.insert(reserve_transactions).values({
      id: uuidv4(),
      reserveId: uuidv4(),
      transactionId: uuidv4(),
      amount: amountInCents,
      currency: "BRL",
      purpose,
      direction: "payout",
      status: "completed",
    });

    return this.getReserve(driverId);
  }
}

export const reserveEngine = new ReserveEngine();