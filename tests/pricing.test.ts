import { calculateQuote } from "../packages/pricing/src/engine/calculator";

describe("Pricing Engine", () => {
  test("calculateQuote with standard price", () => {
    const result = calculateQuote(7.0, 10.0, 5.0, 1.0, 0);

    expect(result.originalPrice).toBe(21.59);
    expect(result.promotionDiscount).toBe(0);
    expect(result.passengerPrice).toBe(21.59);
    expect(result.driverCredit).toBe(21.59);
  });

  test("calculateQuote with promotion discount", () => {
    const result = calculateQuote(7.0, 10.0, 5.0, 1.0, 7.03);

    expect(result.originalPrice).toBe(21.59);
    expect(result.promotionDiscount).toBeCloseTo(7.03, 2);
    expect(result.passengerPrice).toBeCloseTo(14.56, 2);
    expect(result.driverCredit).toBeCloseTo(14.56, 2);
  });

  test("driverCredit equals passengerPrice", () => {
    const result = calculateQuote(7.0, 10.0, 5.0, 1.0, 7.03);

    expect(result.driverCredit).toBeCloseTo(result.passengerPrice, 2);
  });
});