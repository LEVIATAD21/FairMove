import { computeDiscountCents, type CouponCampaign } from "../packages/promotions/src/engine/promotion-engine";

function campaign(overrides: Partial<CouponCampaign> = {}): CouponCampaign {
  return {
    id: "c1",
    discount_type: "percent",
    discount_value: 10,
    is_active: true,
    max_uses: null,
    uses_count: 0,
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

describe("Promotion Engine - computeDiscountCents", () => {
  test("percent campaign applies percentage of the price", () => {
    expect(computeDiscountCents(campaign({ discount_value: 10 }), 0, 2159)).toBe(216);
    expect(computeDiscountCents(campaign({ discount_value: 50 }), 0, 2000)).toBe(1000);
  });

  test("fixed campaign value is already in cents", () => {
    expect(computeDiscountCents(campaign({ discount_type: "fixed", discount_value: 500 }), 0, 2159)).toBe(500);
  });

  test("percent above 100 is clamped to full price", () => {
    expect(computeDiscountCents(campaign({ discount_value: 150 }), 0, 1000)).toBe(1000);
  });

  test("discount never exceeds the ride price", () => {
    expect(computeDiscountCents(campaign({ discount_type: "fixed", discount_value: 99999 }), 0, 1000)).toBe(1000);
  });

  test("without campaign falls back to coupon value in cents", () => {
    expect(computeDiscountCents(null, 703, 2159)).toBe(703);
    expect(computeDiscountCents(undefined, 703, 2159)).toBe(703);
  });

  test("invalid prices or values produce zero discount", () => {
    expect(computeDiscountCents(campaign(), 0, 0)).toBe(0);
    expect(computeDiscountCents(campaign(), 0, -100)).toBe(0);
    expect(computeDiscountCents(campaign({ discount_value: -10 }), 0, 1000)).toBe(0);
    expect(computeDiscountCents(null, -5, 1000)).toBe(0);
  });
});
