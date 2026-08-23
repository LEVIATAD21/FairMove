import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";

const validTransitions: Record<string, string[]> = {
  REQUESTED: ["SEARCHING", "CANCELLED_BY_PASSENGER", "CANCELLED_BY_SYSTEM", "EXPIRED"],
  SEARCHING: ["DRIVER_ASSIGNED", "CANCELLED_BY_PASSENGER", "CANCELLED_BY_SYSTEM", "EXPIRED"],
  DRIVER_ASSIGNED: ["DRIVER_ARRIVING", "CANCELLED_BY_PASSENGER", "CANCELLED_BY_SYSTEM"],
  DRIVER_ARRIVING: ["DRIVER_AT_PICKUP", "CANCELLED_BY_DRIVER", "CANCELLED_BY_SYSTEM"],
  DRIVER_AT_PICKUP: ["PASSENGER_ONBOARD", "CANCELLED_BY_DRIVER", "CANCELLED_BY_SYSTEM"],
  PASSENGER_ONBOARD: ["IN_PROGRESS", "CANCELLED_BY_DRIVER", "CANCELLED_BY_SYSTEM"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED_BY_PASSENGER", "CANCELLED_BY_DRIVER", "CANCELLED_BY_SYSTEM"],
  COMPLETED: [],
  CANCELLED_BY_PASSENGER: [],
  CANCELLED_BY_DRIVER: [],
  CANCELLED_BY_SYSTEM: [],
  EXPIRED: [],
  DISPUTED: [],
};

export type RideStatus = keyof typeof validTransitions;

export function canTransition(from: string, to: string): boolean {
  const allowed = validTransitions[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function transitionRide(from: string, to: string): { success: boolean; error?: string } {
  if (canTransition(from, to)) {
    return { success: true };
  }
  return { success: false, error: `Invalid transition from ${from} to ${to}` };
}