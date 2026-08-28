import { Router } from "express";
import { db, fraud_events, risk_scores } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { fraudEngine } from "./engine/fraud-engine";

const router = Router();

// Calculate user risk
router.post("/risk/:userId", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };

    const result = await fraudEngine.calculateUserRisk(userId);

    return res.json(result);
  } catch (error) {
    console.error("Calculate user risk error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Register fraud event
router.post("/event", async (req, res) => {
  try {
    const { userId, rideId, eventType, riskLevel, score, description, metadata } = req.body;

    if (!userId || !eventType || !riskLevel || score === undefined) {
      return res.status(400).json({ error: "Missing required fields: userId, eventType, riskLevel, score" });
    }

    await fraudEngine.registerEvent(
      userId,
      rideId,
      eventType,
      riskLevel,
      score,
      description,
      metadata
    );

    return res.json({ message: "Evento de fraude registrado com sucesso" });
  } catch (error) {
    console.error("Register fraud event error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get user risk score
router.get("/score/:userId", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };

    const existing = await db.select().from(risk_scores).where(
      eq(risk_scores.userId, userId)
    );

    if (existing.length === 0) {
      return res.json({ hasScore: false });
    }

    return res.json({ hasScore: true, score: existing[0] });
  } catch (error) {
    console.error("Get risk score error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get fraud events for user
router.get("/events/:userId", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };

    const { desc } = await import("drizzle-orm");
    const events = await db.select().from(fraud_events).where(
      eq(fraud_events.userId, userId)
    ).orderBy(desc(fraud_events.createdAt));

    return res.json(events);
  } catch (error) {
    console.error("Get fraud events error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const fraudRouter = router;
