import { Router, type Request, type Response } from "express";
import { db, pricing_quotes } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { requireAuth } from "../../auth/src/middleware";
import { validateBody, LatSchema, LngSchema } from "@fairmove/validation";
import { haversineKm, estimateDurationMinutes, toCents, fromCents } from "@fairmove/shared-types";
import { calculateQuote, PRICING_RULES } from "./engine/calculator";

const router = Router();

const QuoteRequestSchema = z
  .object({
    pickupLocationLat: LatSchema.optional(),
    pickupLocationLng: LngSchema.optional(),
    dropoffLocationLat: LatSchema.optional(),
    dropoffLocationLng: LngSchema.optional(),
    distanceKm: z.coerce.number().positive().max(1000).optional(),
    timeMinutes: z.coerce.number().positive().max(24 * 60).optional(),
    dynamicAdjustment: z.coerce.number().min(0.1).max(10).optional(),
    promotionDiscount: z.coerce.number().min(0).max(100000).optional(),
  })
  .refine(
    (v) =>
      (v.distanceKm !== undefined && v.timeMinutes !== undefined) ||
      (v.pickupLocationLat !== undefined &&
        v.pickupLocationLng !== undefined &&
        v.dropoffLocationLat !== undefined &&
        v.dropoffLocationLng !== undefined),
    { message: "Provide either distanceKm+timeMinutes or pickup/dropoff coordinates" }
  );

function resolveDistanceAndTime(body: z.infer<typeof QuoteRequestSchema>): {
  distanceKm: number;
  timeMinutes: number;
} {
  if (
    body.pickupLocationLat !== undefined &&
    body.pickupLocationLng !== undefined &&
    body.dropoffLocationLat !== undefined &&
    body.dropoffLocationLng !== undefined
  ) {
    const distanceKm = haversineKm(
      { lat: body.pickupLocationLat, lng: body.pickupLocationLng },
      { lat: body.dropoffLocationLat, lng: body.dropoffLocationLng }
    );
    return { distanceKm, timeMinutes: estimateDurationMinutes(distanceKm) };
  }
  return { distanceKm: body.distanceKm!, timeMinutes: body.timeMinutes! };
}

// Calculate a quote (persistida para auditoria)
router.post(
  "/quote",
  requireAuth,
  validateBody(QuoteRequestSchema),
  async (req: Request, res: Response) => {
    try {
      const { distanceKm, timeMinutes } = resolveDistanceAndTime(req.body);
      const dynamicAdjustment = req.body.dynamicAdjustment ?? 1.0;
      const promotionDiscount = req.body.promotionDiscount ?? 0;

      const result = calculateQuote(
        PRICING_RULES.baseFare,
        distanceKm,
        timeMinutes,
        dynamicAdjustment,
        promotionDiscount
      );

      const quoteId = uuidv4();
      await db.insert(pricing_quotes).values({
        id: quoteId,
        userId: req.user!.id,
        base_fare: toCents(PRICING_RULES.baseFare),
        distance_fare_per_km: toCents(PRICING_RULES.perKm),
        time_fare_per_minute: toCents(PRICING_RULES.perMinute),
        dynamic_adjustment: Math.round(dynamicAdjustment * 100),
        promotion_discount: toCents(result.promotionDiscount),
        original_price: toCents(result.originalPrice),
        final_passenger_price: toCents(result.passengerPrice),
        driver_credit: toCents(result.driverCredit),
      });

      res.status(201).json({
        quoteId,
        ...result,
        distanceKm: Math.round(distanceKm * 100) / 100,
        timeMinutes,
        currency: "BRL",
      });
    } catch (error) {
      console.error("Calculate quote error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get quote by ID — só o dono do quote (ou admin) o enxerga (anti-IDOR).
router.get("/quote/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const quote = await db
      .select()
      .from(pricing_quotes)
      .where(eq(pricing_quotes.id, id));

    if (quote.length === 0) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    const row = quote[0];
    const isOwner = row.userId === req.user!.id;
    if (!isOwner && req.user!.role !== "admin") {
      // Mesmo 404 do "não existe": não confirma a existência de quote alheio.
      res.status(404).json({ error: "Quote not found" });
      return;
    }
    res.json({
      quoteId: row.id,
      originalPrice: fromCents(row.original_price),
      promotionDiscount: fromCents(row.promotion_discount),
      passengerPrice: fromCents(row.final_passenger_price),
      driverCredit: fromCents(row.driver_credit),
      dynamicAdjustment: row.dynamic_adjustment / 100,
      currency: row.currency,
      createdAt: row.created_at,
    });
  } catch (error) {
    console.error("Get quote error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

export const pricingRouter = router;
