import { Router } from "express";
import { db } from "../db";
import { pricing_quotes } from "../db/schema";
import { calculateQuote, seedDefaultQuotes } from "../engine/calculator";
import { v4 as uuidv4 } from "uuid";

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
    const { id } = req.params;

    const quote = db.select().from(pricing_quotes).where(
      // In a real implementation, use proper eq
    );

    return res.json(quote);
  } catch (error) {
    console.error("Get quote error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Seed default quotes (for MVP)
router.post("/seed", async (req, res) => {
  try {
    seedDefaultQuotes();
    return res.json({ message: "Default quotes seeded successfully" });
  } catch (error) {
    console.error("Seed quotes error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const pricingRouter = router;