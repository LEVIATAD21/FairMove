import { db, emergency_reserves, reserve_transactions } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export class ReserveEngine {
  async getReserve(driverId: string) {
    const reserve = await db.select().from(emergency_reserves).where(
      eq(emergency_reserves.driverId, driverId)
    );
    return reserve.length > 0 ? reserve[0] : null;
  }

  async initializeReserve(driverId: string) {
    const existing = await this.getReserve(driverId);

    if (existing) {
      return existing;
    }

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
      allocatedEmergencyUsage = newTotal;
    }

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

    const reserve = await this.getReserve(driverId);
    if (!reserve) {
      throw new Error("Reserve not found");
    }

    const currentTotal = Number(reserve.total_reserve);
    if (currentTotal < amountInCents) {
      throw new Error("Insufficient reserve balance");
    }

    const newTotal = currentTotal - amountInCents;
    const newEmergencyUsage = Number(reserve.emergency_usage) || 0;
    const reducedEmergencyUsage = Math.max(0, newEmergencyUsage - amountInCents);

    await db.update(emergency_reserves).set({
      total_reserve: newTotal,
      emergency_usage: reducedEmergencyUsage,
      updated_at: new Date(),
    }).where(eq(emergency_reserves.driverId, driverId));

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
