import { Router } from "express";
import { db, pricing_quotes } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { calculateQuote } from "./engine/calculator";

const router = Router();

// Calculate a quote
router.post("/quote", async (req, res) => {
  try {
    const { baseFare, distanceKm, timeMinutes, dynamicAdjustment, promotionDiscount } = req.body;

    const result = calculateQuote(
      baseFare !== undefined ? baseFare : 7.0,
      distanceKm !== undefined ? distanceKm : 10.0,
      timeMinutes !== undefined ? timeMinutes : 5.0,
      dynamicAdjustment !== undefined ? dynamicAdjustment : 1.0,
      promotionDiscount !== undefined ? promotionDiscount : 0
    );

    return res.json({
      originalPrice: result.originalPrice,
      promotionDiscount: result.promotionDiscount,
      passengerPrice: result.passengerPrice,
      driverCredit: result.driverCredit,
    });
  } catch (error) {
    console.error("Calculate quote error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get quote by ID
router.get("/quote/:id", async (req, res) => {
  try {
    const { id } = req.params as { id: string };

    const quote = await db.select().from(pricing_quotes).where(
      eq(pricing_quotes.id, id)
    );

    if (quote.length === 0) {
      return res.status(404).json({ error: "Quote not found" });
    }

    return res.json(quote[0]);
  } catch (error) {
    console.error("Get quote error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const pricingRouter = router;
