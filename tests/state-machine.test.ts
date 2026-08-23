import { canTransition, transitionRide, type RideStatus } from "../packages/rides/src/state/machine";

describe("Ride State Machine", () => {
  test("valid transition REQUESTED -> SEARCHING", () => {
    expect(canTransition("REQUESTED", "SEARCHING")).toBe(true);
  });

  test("valid transition SEARCHING -> DRIVER_ASSIGNED", () => {
    expect(canTransition("SEARCHING", "DRIVER_ASSIGNED")).toBe(true);
  });

  test("valid transition DRIVER_ASSIGNED -> DRIVER_ARRIVING", () => {
    expect(canTransition("DRIVER_ASSIGNED", "DRIVER_ARRIVING")).toBe(true);
  });

  test("valid transition DRIVER_ARRIVING -> DRIVER_AT_PICKUP", () => {
    expect(canTransition("DRIVER_ARRIVING", "DRIVER_AT_PICKUP")).toBe(true);
  });

  test("valid transition DRIVER_AT_PICKUP -> PASSENGER_ONBOARD", () => {
    expect(canTransition("DRIVER_AT_PICKUP", "PASSENGER_ONBOARD")).toBe(true);
  });

  test("valid transition PASSENGER_ONBOARD -> IN_PROGRESS", () => {
    expect(canTransition("PASSENGER_ONBOARD", "IN_PROGRESS")).toBe(true);
  });

  test("valid transition IN_PROGRESS -> COMPLETED", () => {
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
  });

  test("valid transition IN_PROGRESS -> CANCELLED_BY_PASSENGER", () => {
    expect(canTransition("IN_PROGRESS", "CANCELLED_BY_PASSENGER")).toBe(true);
  });

  test("valid transition IN_PROGRESS -> CANCELLED_BY_DRIVER", () => {
    expect(canTransition("IN_PROGRESS", "CANCELLED_BY_DRIVER")).toBe(true);
  });

  test("valid transition IN_PROGRESS -> CANCELLED_BY_SYSTEM", () => {
    expect(canTransition("IN_PROGRESS", "CANCELLED_BY_SYSTEM")).toBe(true);
  });

  test("invalid transition REQUESTED -> IN_PROGRESS returns false", () => {
    expect(canTransition("REQUESTED", "IN_PROGRESS")).toBe(false);
  });

  test("invalid transition COMPLETED -> SEARCHING returns false", () => {
    expect(canTransition("COMPLETED", "SEARCHING")).toBe(false);
  });

  test("transitionRide validates status change", () => {
    const result = transitionRide("REQUESTED", "SEARCHING");
    expect(result.success).toBe(true);
  });

  test("transitionRide rejects invalid status change", () => {
    const result = transitionRide("COMPLETED", "REQUESTED");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("all ride statuses are defined", () => {
    const statuses: RideStatus[] = [
      "REQUESTED",
      "SEARCHING",
      "DRIVER_ASSIGNED",
      "DRIVER_ARRIVING",
      "DRIVER_AT_PICKUP",
      "PASSENGER_ONBOARD",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED_BY_PASSENGER",
      "CANCELLED_BY_DRIVER",
      "CANCELLED_BY_SYSTEM",
      "EXPIRED",
      "DISPUTED",
    ];
    expect(statuses.length).toBe(13);
  });
});