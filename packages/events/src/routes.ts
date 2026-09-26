import { Router, type Request, type Response } from "express";
import { db, events, eventParticipants, eventLeaderboard, rewardWalletTransactions, cinemaRewardClaims, drivers } from "@fairmove/shared-db";
import { eq, and, desc, gte, lte, sql, count } from "drizzle-orm";
import { requireAuth, requireSelfOrRole, requireRole, type AuthUser } from "../../auth/src/middleware";
import { v4 as uuidv4 } from "uuid";
import { calculateDriverMetrics, recalculateLeaderboard, getRewardBreakdown, getLeaderboard } from "./engine/scoring-engine";

const router = Router();

async function assertDriverEligible(user: AuthUser): Promise<{ driverId: string } | null> {
  if (user.role !== "driver") return null;
  const driverRow = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.userId, user.id))
    .limit(1);
  if (driverRow.length === 0) return null;
  return { driverId: driverRow[0].id };
}

router.get("/events/active", requireAuth, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const activeEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.status, "running"), lte(events.startDate, now), gte(events.endDate, now)))
      .orderBy(desc(events.startDate));

    return res.json(activeEvents);
  } catch (error) {
    console.error("Get active events error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:eventId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params as { eventId: string };
    const event = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
    if (event.length === 0) return res.status(404).json({ error: "Evento não encontrado" });
    return res.json(event[0]);
  } catch (error) {
    console.error("Get event error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/events/:eventId/enroll", requireAuth, async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params as { eventId: string };
    const user = req.user!;

    const eligibility = await assertDriverEligible(user);
    if (!eligibility) {
      return res.status(403).json({ error: "Apenas motoristas elegíveis podem participar" });
    }

    const event = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
    if (event.length === 0) return res.status(404).json({ error: "Evento não encontrado" });
    if (event[0].status !== "running") return res.status(400).json({ error: "Evento não está aberto para inscrições" });

    const existing = await db
      .select()
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.driverId, eligibility.driverId)))
      .limit(1);
    if (existing.length > 0) return res.status(409).json({ error: "Já inscrito neste evento" });

    const idempotencyKey = req.header("Idempotency-Key") ?? `enroll-${eventId}-${eligibility.driverId}-${Date.now()}`;
    const existingKey = await db.select().from(eventParticipants).where(eq(eventParticipants.idempotencyKey, idempotencyKey)).limit(1);
    if (existingKey.length > 0) return res.status(409).json({ error: "Inscrição já processada" });

    await db.transaction(async (tx) => {
      await tx.insert(eventParticipants).values({
        id: uuidv4(),
        eventId,
        driverId: eligibility.driverId,
        paymentStatus: "paid",
        idempotencyKey,
      });

      await tx.insert(rewardWalletTransactions).values({
        id: uuidv4(),
        driverId: eligibility.driverId,
        eventId,
        type: "debit",
        amount: event[0].buyInFee,
        currency: "BRL",
        description: `Buy-in FairMove League: ${event[0].title}`,
        status: "completed",
        idempotencyKey: `buy-in-${idempotencyKey}`,
      });
    });

    return res.status(201).json({ message: "Inscrição confirmada" });
  } catch (error) {
    console.error("Enroll event error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:eventId/leaderboard", requireAuth, async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params as { eventId: string };
    const leaderboard = await getLeaderboard(eventId);
    return res.json(leaderboard);
  } catch (error) {
    console.error("Get leaderboard error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:eventId/my-position", requireAuth, async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params as { eventId: string };
    const user = req.user!;
    const eligibility = await assertDriverEligible(user);
    if (!eligibility) return res.status(403).json({ error: "Não elegível" });

    const entry = await db
      .select()
      .from(eventLeaderboard)
      .where(and(eq(eventLeaderboard.eventId, eventId), eq(eventLeaderboard.driverId, eligibility.driverId)))
      .limit(1);

    if (entry.length === 0) return res.json({ enrolled: false });

    const tier = entry[0].rewardTier ?? "tier_5_10";
    const reward = getRewardBreakdown(tier);
    return res.json({ ...entry[0], reward, enrolled: true });
  } catch (error) {
    console.error("Get my position error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/my-rewards", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const eligibility = await assertDriverEligible(user);
    if (!eligibility) return res.status(403).json({ error: "Apenas motoristas" });

    const rewards = await db
      .select()
      .from(rewardWalletTransactions)
      .where(eq(rewardWalletTransactions.driverId, eligibility.driverId))
      .orderBy(desc(rewardWalletTransactions.createdAt));

    return res.json(rewards);
  } catch (error) {
    console.error("Get my rewards error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/events/cinema/claim", requireAuth, async (req: Request, res: Response) => {
  try {
    const { eventId, cinemaLink, pixKey } = req.body as { eventId: string; cinemaLink: string; pixKey?: string };
    const user = req.user!;
    const eligibility = await assertDriverEligible(user);
    if (!eligibility) return res.status(403).json({ error: "Não elegível" });

    const entry = await db
      .select()
      .from(eventLeaderboard)
      .where(and(eq(eventLeaderboard.eventId, eventId), eq(eventLeaderboard.driverId, eligibility.driverId)))
      .limit(1);
    if (entry.length === 0 || entry[0].rank !== 1) {
      return res.status(403).json({ error: "Apenas o 1º lugar pode resgatar o Cinema FairMove" });
    }

    const existing = await db
      .select()
      .from(cinemaRewardClaims)
      .where(and(eq(cinemaRewardClaims.eventId, eventId), eq(cinemaRewardClaims.driverId, eligibility.driverId)))
      .limit(1);
    if (existing.length > 0) return res.status(409).json({ error: "Solicitação já existe" });

    await db.insert(cinemaRewardClaims).values({
      id: uuidv4(),
      driverId: eligibility.driverId,
      eventId,
      cinemaLink,
      pixKey,
      amount: 200_000,
      status: "pending_approval",
    });

    return res.status(201).json({ message: "Solicitação enviada para aprovação" });
  } catch (error) {
    console.error("Cinema claim error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/cinema/claims", requireAuth, requireSelfOrRole("driverId", "admin"), async (req: Request, res: Response) => {
  try {
    const claims = await db
      .select()
      .from(cinemaRewardClaims)
      .orderBy(desc(cinemaRewardClaims.createdAt));
    return res.json(claims);
  } catch (error) {
    console.error("Get cinema claims error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/events/cinema/claims/:claimId/approve", requireAuth, requireSelfOrRole("driverId", "admin"), async (req: Request, res: Response) => {
  try {
    const { claimId } = req.params as { claimId: string };
    const { adminNotes } = req.body as { adminNotes?: string };

    await db
      .update(cinemaRewardClaims)
      .set({ status: "approved", adminNotes, approvedAt: new Date(), approvedBy: req.user!.id })
      .where(eq(cinemaRewardClaims.id, claimId));

    return res.json({ message: "Aprovado" });
  } catch (error) {
    console.error("Approve cinema claim error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin routes
router.get("/admin/events", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const allEvents = await db.select().from(events).orderBy(desc(events.createdAt));
    return res.json(allEvents);
  } catch (error) {
    console.error("Admin get events error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/events", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const { title, description, startDate, endDate, buyInFee, maxParticipants } = req.body;
    if (!title || !startDate || !endDate) {
      return res.status(400).json({ error: "Campos obrigatórios: title, startDate, endDate" });
    }
    const newEvent = await db.insert(events).values({
      id: uuidv4(),
      title,
      description,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      buyInFee: buyInFee ?? 2000,
      maxParticipants,
      status: "draft",
    }).returning();
    return res.status(201).json(newEvent[0]);
  } catch (error) {
    console.error("Admin create event error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/events/:eventId", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const eventId = Array.isArray(req.params.eventId) ? req.params.eventId[0] : req.params.eventId;
    const { status, ...updates } = req.body;
    await db.update(events).set({ ...updates, updatedAt: new Date() }).where(eq(events.id, eventId));
    return res.json({ message: "Evento atualizado" });
  } catch (error) {
    console.error("Admin update event error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/events/:eventId/recalculate", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const eventId = Array.isArray(req.params.eventId) ? req.params.eventId[0] : req.params.eventId;
    await recalculateLeaderboard(eventId);
    return res.json({ message: "Leaderboard recalculado" });
  } catch (error) {
    console.error("Admin recalculate error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const eventsRouter = router;