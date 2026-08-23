import { db } from "../db";
import { campaigns, coupons, promotion_redemptions, rides } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export interface PromotionResult {
  discountApplied: boolean;
  discountAmount: number; // in cents
  finalPrice: number; // in cents
  driverCredit: number; // in cents
  redemptionId?: string;
}

export function applyPromotion(
  rideId: string,
  passengerId: string,
  couponCode?: string
): PromotionResult {
  // Default: no promotion
  let discountAmount = 0;
  let redemptionId = "";

  // If coupon code provided, check it
  if (couponCode) {
    const coupon = db.select().from(coupons).where(
      eq(coupons.code, couponCode)
    );

    if (coupon.length > 0 && coupon[0].is_active) {
      // Check if coupon is not expired
      const now = new Date();
      if (coupon[0].expires_at && new Date(coupon[0].expires_at) < now) {
        return { discountApplied: false, discountAmount: 0, finalPrice: 0, driverCredit: 0 };
      }

      // Check if coupon has remaining uses
      if (coupon[0].is_single_use && coupon[0].times_used >= 1) {
        return { discountApplied: false, discountAmount: 0, finalPrice: 0, driverCredit: 0 };
      }

      if (coupon[0].max_uses >= 0 && coupon[0].uses_count >= coupon[0].max_uses) {
        return { discountApplied: false, discountAmount: 0, finalPrice: 0, driverCredit: 0 };
      }

      // Apply the promotion
      discountAmount = coupon[0].discount_value;
      const redemptionId = uuidv4();

      // Record the redemption
      db.insert(promotion_redemptions).values({
        id: redemptionId,
        rideId,
        couponId: coupon[0].id,
        passengerId,
        redemptionCode: couponCode,
        amount_discounted: discountAmount,
      });

      // Update coupon uses count
      db.update(coupons).set({
        uses_count: coupon[0].uses_count + 1,
      }).where(eq(coupons.id, coupon[0].id));
    }
  }

  // Get the base ride price (without promotion)
  const ride = db.select().from(rides).where(eq(rides.id, rideId));

  if (ride.length === 0) {
    return { discountApplied: false, discountAmount: 0, finalPrice: 0, driverCredit: 0 };
  }

  const basePrice = ride[0].finalPassengerPrice;
  const driverCredit = basePrice; // Rule: driverCredit = passengerPrice

  const finalPrice = basePrice - discountAmount;

  return {
    discountApplied: discountAmount > 0,
    discountAmount,
    finalPrice: Math.max(0, finalPrice),
    driverCredit: Math.max(0, driverCredit),
    redemptionId,
  };
}

export function createCampaign(
  name: string,
  discountType: "percent" | "fixed",
  discountValue: number,
  targetType: "ride" | "user" | "region" | "category" = "ride",
  maxUses?: number,
  startDate?: Date,
  endDate?: Date
) {
  const id = uuidv4();
  db.insert(campaigns).values({
    id,
    name,
    discount_type: discountType,
    discount_value: discountValue,
    target_type: targetType,
    max_uses: maxUses,
    start_date: startDate,
    end_date: endDate,
    is_active: true,
  });

  return id;
}

export function generateCouponCode(campaignId: string): string {
  const code = `FAIR${uuidv4().toString().substring(0, 8).toUpperCase()}`;
  db.insert(coupons).values({
    id: uuidv4(),
    code,
    campaignId,
    is_single_use: true,
  });

  return code;
}