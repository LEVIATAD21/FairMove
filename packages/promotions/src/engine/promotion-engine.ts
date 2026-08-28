import { db, campaigns, coupons, promotion_redemptions, rides } from "@fairmove/shared-db";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export interface PromotionResult {
  discountApplied: boolean;
  discountAmount: number;
  finalPrice: number;
  driverCredit: number;
  redemptionId?: string;
}

export async function applyPromotion(
  rideId: string,
  passengerId: string,
  couponCode?: string
): Promise<PromotionResult> {
  let discountAmount = 0;
  let redemptionId = "";

  if (couponCode) {
    const coupon = await db.select().from(coupons).where(
      eq(coupons.code, couponCode)
    );

    if (coupon.length > 0 && coupon[0].is_active) {
      const now = new Date();
      if (coupon[0].expires_at && new Date(coupon[0].expires_at) < now) {
        return { discountApplied: false, discountAmount: 0, finalPrice: 0, driverCredit: 0 };
      }

      if (coupon[0].is_single_use && coupon[0].times_used >= 1) {
        return { discountApplied: false, discountAmount: 0, finalPrice: 0, driverCredit: 0 };
      }

      if (coupon[0].max_uses != null && coupon[0].uses_count >= coupon[0].max_uses) {
        return { discountApplied: false, discountAmount: 0, finalPrice: 0, driverCredit: 0 };
      }

      discountAmount = coupon[0].discount_value || 0;
      const newRedemptionId = uuidv4();

      await db.insert(promotion_redemptions).values({
        id: newRedemptionId,
        rideId,
        couponId: coupon[0].id,
        passengerId,
        redemptionCode: couponCode,
        amount_discounted: discountAmount,
      });

      await db.update(coupons).set({
        times_used: (coupon[0].times_used || 0) + 1,
      }).where(eq(coupons.id, coupon[0].id));

      redemptionId = newRedemptionId;
    }
  }

  const ride = await db.select().from(rides).where(eq(rides.id, rideId));

  if (ride.length === 0) {
    return { discountApplied: false, discountAmount: 0, finalPrice: 0, driverCredit: 0 };
  }

  const basePrice = ride[0].finalPassengerPrice;
  const driverCredit = basePrice;

  const finalPrice = basePrice - discountAmount;

  return {
    discountApplied: discountAmount > 0,
    discountAmount,
    finalPrice: Math.max(0, finalPrice),
    driverCredit: Math.max(0, driverCredit),
    redemptionId,
  };
}

export async function createCampaign(
  name: string,
  discountType: "percent" | "fixed",
  discountValue: number,
  targetType: "ride" | "user" | "region" | "category" = "ride",
  maxUses?: number,
  startDate?: Date,
  endDate?: Date
): Promise<string> {
  const id = uuidv4();
  await db.insert(campaigns).values({
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

export async function generateCouponCode(campaignId: string): Promise<string> {
  const code = `FAIR${uuidv4().toString().substring(0, 8).toUpperCase()}`;
  await db.insert(coupons).values({
    id: uuidv4(),
    code,
    campaignId,
    is_single_use: true,
  });

  return code;
}
