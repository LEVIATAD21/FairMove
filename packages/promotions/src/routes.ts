import { Router } from "express";
import { db } from "../db";
import { campaigns, coupons, promotion_redemptions, rides } from "../db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { applyPromotion, createCampaign, generateCouponCode } from "../engine/promotion-engine";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// Calculate quote with promotion
router.post("/quote", async (req, res) => {
  try {
    const { rideId, passengerId, couponCode } = req.body;

    if (!rideId || !passengerId) {
      return res.status(400).json({ error: "Ride ID and Passenger ID are required" });
    }

    const result = applyPromotion(rideId, passengerId, couponCode);

    return res.json(result);
  } catch (error) {
    console.error("Apply promotion error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Create campaign
router.post("/campaign", async (req, res) => {
  try {
    const { name, discountType, discountValue, targetType, maxUses, startDate, endDate } = req.body;

    if (!name || discountType === undefined || discountValue === undefined) {
      return res.status(400).json({ error: "Name, discount type and discount value are required" });
    }

    const campaignId = createCampaign(
      name,
      discountType,
      discountValue,
      targetType,
      maxUses,
      startDate,
      endDate
    );

    return res.status(201).json({ campaignId });
  } catch (error) {
    console.error("Create campaign error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Generate coupon
router.post("/campaign/:campaignId/coupon", async (req, res) => {
  try {
    const { campaignId } = req.params;

    const code = generateCouponCode(campaignId);

    return res.json({ couponCode: code });
  } catch (error) {
    console.error("Generate coupon error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get campaigns
router.get("/campaigns", async (req, res) => {
  try {
    const allCampaigns = db.select().from(campaigns).where(eq(campaigns.is_active, true));

    return res.json(allCampaigns);
  } catch (error) {
    console.error("Get campaigns error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const promotionRouter = router;