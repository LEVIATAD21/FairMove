import {
  haversineKm,
  estimateDurationMinutes,
  toCents,
  fromCents,
  safeNonNegative,
  isValidLatitude,
  isValidLongitude,
} from "../packages/shared-types/src/index";

describe("shared-types helpers", () => {
  test("haversineKm returns 0 for identical points and ~111km per degree", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 0);
  });

  test("estimateDurationMinutes is monotonic with distance", () => {
    expect(estimateDurationMinutes(0)).toBe(0);
    expect(estimateDurationMinutes(-5)).toBe(0);
    expect(estimateDurationMinutes(10)).toBeGreaterThan(estimateDurationMinutes(1));
    expect(estimateDurationMinutes(10)).toBeGreaterThanOrEqual(1);
  });

  test("toCents/fromCents round-trip BRL values", () => {
    expect(toCents(10.5)).toBe(1050);
    expect(toCents(0.1) + toCents(0.2)).toBe(30);
    expect(fromCents(2159)).toBe(21.59);
    expect(fromCents(toCents(14.56))).toBeCloseTo(14.56, 2);
  });

  test("safeNonNegative clamps negatives and non-finite values", () => {
    expect(safeNonNegative(-5)).toBe(0);
    expect(safeNonNegative(Number.NaN)).toBe(0);
    expect(safeNonNegative(42)).toBe(42);
  });

  test("latitude/longitude validation", () => {
    expect(isValidLatitude(0)).toBe(true);
    expect(isValidLatitude(-23.55)).toBe(true);
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLongitude(-46.63)).toBe(true);
    expect(isValidLongitude(181)).toBe(false);
  });
});
