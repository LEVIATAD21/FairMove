import { Router, type Request, type Response } from "express";
import { db, events, eventParticipants, eventLeaderboard, rewardWalletTransactions, cinemaRewardClaims, eventRewards, drivers } from "@fairmove/shared-db";
import { eq, and, desc, gte, lte, sql, count, asc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthUser } from "../../auth/src/middleware";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { validateBody } from "@fairmove/validation";
import { calculateDriverMetrics, recalculateLeaderboard, getRewardBreakdown, getLeaderboard } from "./engine/scoring-engine";
import { calculateEventRewards } from "./engine/rewards-engine";

const router = Router();

// ---------------------------------------------------------------------------
// Validação de entrada (Zod) — todo body de escrita passa por aqui.
// ---------------------------------------------------------------------------
const UuidSchema = z.string().uuid();

const CinemaClaimSchema = z.object({
  eventId: UuidSchema,
  cinemaLink: z.string().url().max(2048),
  // Chave PIX = PII: tamanho limitado, formato livre (Banco Central aceita
  // CPF/CNPJ/e-mail/telefone/aleatória — validação é do app admin).
  pixKey: z.string().trim().min(1).max(100).optional(),
});

const AdminCreateEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  buyInFee: z.number().int().min(0).max(1_000_000_000).optional(),
  maxParticipants: z.number().int().min(1).max(100_000).optional(),
});

const AdminUpdateEventSchema = z
  .object({
    // Whitelist explícita: qualquer coluna fora daqui é rejeitada (mass assignment).
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    buyInFee: z.number().int().min(0).max(1_000_000_000),
    maxParticipants: z.number().int().min(1).max(100_000).nullable(),
    status: z.enum(["draft", "open", "running", "closed", "cancelled"]),
  })
  .partial();

const ApproveClaimSchema = z.object({
  adminNotes: z.string().trim().max(2000).optional(),
});

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

/** Leaderboard/prêmios só para admin ou motorista inscrito no evento. */
async function canViewEventStandings(user: AuthUser, eventId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const eligibility = await assertDriverEligible(user);
  if (!eligibility) return false;
  const enrolled = await db
    .select({ id: eventParticipants.id })
    .from(eventParticipants)
    .where(
      and(
        eq(eventParticipants.eventId, eventId),
        eq(eventParticipants.driverId, eligibility.driverId)
      )
    )
    .limit(1);
  return enrolled.length > 0;
}

/** Saldo do "reward wallet" do motorista (créditos − débitos) em centavos. */
async function rewardBalanceCents(driverId: string): Promise<number> {
  const rows = await db
    .select({
      balance: sql<number>`COALESCE(SUM(CASE
        WHEN ${rewardWalletTransactions.type} = 'credit' THEN ${rewardWalletTransactions.amount}
        WHEN ${rewardWalletTransactions.type} = 'debit' THEN -${rewardWalletTransactions.amount}
        ELSE 0 END), 0)::int`,
    })
    .from(rewardWalletTransactions)
    .where(eq(rewardWalletTransactions.driverId, driverId));
  return Number(rows[0]?.balance ?? 0);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
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
    console.error("Get active events error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:eventId", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = UuidSchema.safeParse(req.params.eventId);
    if (!parsed.success) return res.status(404).json({ error: "Evento não encontrado" });
    const event = await db.select().from(events).where(eq(events.id, parsed.data)).limit(1);
    if (event.length === 0) return res.status(404).json({ error: "Evento não encontrado" });
    return res.json(event[0]);
  } catch (error) {
    console.error("Get event error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/events/:eventId/enroll", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsedId = UuidSchema.safeParse(req.params.eventId);
    if (!parsedId.success) return res.status(404).json({ error: "Evento não encontrado" });
    const eventId = parsedId.data;
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

    // Vagas: maxParticipants era declarado e nunca conferido.
    if (event[0].maxParticipants !== null) {
      const participants = await db
        .select({ total: count() })
        .from(eventParticipants)
        .where(eq(eventParticipants.eventId, eventId));
      if (Number(participants[0]?.total ?? 0) >= event[0].maxParticipants) {
        return res.status(409).json({ error: "Evento lotado" });
      }
    }

    const buyInFee = event[0].buyInFee;

    // Buy-in precisa de lastro: o "débito" era gravado sem checar saldo —
    // qualquer conta recém-criada inscrevia "pagando" R$0 de recompensas.
    if (buyInFee > 0) {
      const balance = await rewardBalanceCents(eligibility.driverId);
      if (balance < buyInFee) {
        return res.status(402).json({
          error: "insufficient_reward_balance",
          message: "Saldo de recompensas insuficiente para o buy-in",
          balanceCents: balance,
          requiredCents: buyInFee,
        });
      }
    }

    // Chave determinística (nunca Date.now()): corrida de duas inscrições
    // simultâneas colide no UNIQUE de idempotencyKey e vira 409.
    const idempotencyKey = `enroll-${eventId}-${eligibility.driverId}`;

    try {
      await db.transaction(async (tx) => {
        await tx.insert(eventParticipants).values({
          id: uuidv4(),
          eventId,
          driverId: eligibility.driverId,
          paymentStatus: "paid",
          idempotencyKey,
        });

        if (buyInFee > 0) {
          await tx.insert(rewardWalletTransactions).values({
            id: uuidv4(),
            driverId: eligibility.driverId,
            eventId,
            type: "debit",
            amount: buyInFee,
            currency: "BRL",
            description: `Buy-in FairMove League: ${event[0].title}`,
            status: "completed",
            idempotencyKey: `buy-in-${idempotencyKey}`,
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: "Inscrição já processada" });
      }
      throw error;
    }

    return res.status(201).json({ message: "Inscrição confirmada" });
  } catch (error) {
    console.error("Enroll event error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:eventId/leaderboard", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsedId = UuidSchema.safeParse(req.params.eventId);
    if (!parsedId.success) return res.status(404).json({ error: "Evento não encontrado" });
    if (!(await canViewEventStandings(req.user!, parsedId.data))) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const leaderboard = await getLeaderboard(parsedId.data);
    return res.json(leaderboard);
  } catch (error) {
    console.error("Get leaderboard error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:eventId/my-position", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsedId = UuidSchema.safeParse(req.params.eventId);
    if (!parsedId.success) return res.status(404).json({ error: "Evento não encontrado" });
    const eventId = parsedId.data;
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
    console.error("Get my position error:", error instanceof Error ? error.message : error);
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
    console.error("Get my rewards error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/events/cinema/claim",
  requireAuth,
  validateBody(CinemaClaimSchema),
  async (req: Request, res: Response) => {
    try {
      const { eventId, cinemaLink, pixKey } = req.body as z.infer<typeof CinemaClaimSchema>;
      const user = req.user!;
      const eligibility = await assertDriverEligible(user);
      if (!eligibility) return res.status(403).json({ error: "Não elegível" });

      const eventExists = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);
      if (eventExists.length === 0) return res.status(404).json({ error: "Evento não encontrado" });

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
      console.error("Cinema claim error:", error instanceof Error ? error.message : error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Claims são PII operacional (PIX, links) — admin apenas. (Antes usava
// requireSelfOrRole("driverId") sem :driverId no path: guarda morta.)
router.get("/events/cinema/claims", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const claims = await db
      .select()
      .from(cinemaRewardClaims)
      .orderBy(desc(cinemaRewardClaims.createdAt));
    return res.json(claims);
  } catch (error) {
    console.error("Get cinema claims error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/events/cinema/claims/:claimId/approve",
  requireAuth,
  requireRole("admin"),
  validateBody(ApproveClaimSchema),
  async (req: Request, res: Response) => {
    try {
      const claimId = String(req.params.claimId);
      const { adminNotes } = req.body as z.infer<typeof ApproveClaimSchema>;

      const updated = await db
        .update(cinemaRewardClaims)
        .set({ status: "approved", adminNotes, approvedAt: new Date(), approvedBy: req.user!.id })
        .where(eq(cinemaRewardClaims.id, claimId))
        .returning({ id: cinemaRewardClaims.id });

      if (updated.length === 0) return res.status(404).json({ error: "Claim not found" });

      return res.json({ message: "Aprovado" });
    } catch (error) {
      console.error("Approve cinema claim error:", error instanceof Error ? error.message : error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Admin routes
router.get("/admin/events", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const allEvents = await db
      .select()
      .from(events)
      .orderBy(desc(events.createdAt))
      // BUG-H3: resposta precisa ser bounded; 200 é o teto de listagens admin.
      .limit(200);
    return res.json(allEvents);
  } catch (error) {
    console.error("Admin get events error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/admin/events",
  requireAuth,
  requireRole("admin"),
  validateBody(AdminCreateEventSchema),
  async (req: Request, res: Response) => {
    try {
      const body = req.body as z.infer<typeof AdminCreateEventSchema>;
      const newEvent = await db
        .insert(events)
        .values({
          id: uuidv4(),
          title: body.title,
          description: body.description,
          startDate: body.startDate,
          endDate: body.endDate,
          buyInFee: body.buyInFee ?? 2000,
          maxParticipants: body.maxParticipants,
          status: "draft",
        })
        .returning();
      return res.status(201).json(newEvent[0]);
    } catch (error) {
      console.error("Admin create event error:", error instanceof Error ? error.message : error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.patch(
  "/admin/events/:eventId",
  requireAuth,
  requireRole("admin"),
  validateBody(AdminUpdateEventSchema),
  async (req: Request, res: Response) => {
    try {
      const parsedId = UuidSchema.safeParse(req.params.eventId);
      if (!parsedId.success) return res.status(404).json({ error: "Evento não encontrado" });
      // Whitelist do schema: id/createdAt/status-de-fora nunca passam aqui.
      const updates = { ...(req.body as z.infer<typeof AdminUpdateEventSchema>), updatedAt: new Date() };
      const updated = await db
        .update(events)
        .set(updates)
        .where(eq(events.id, parsedId.data))
        .returning({ id: events.id });
      if (updated.length === 0) return res.status(404).json({ error: "Evento não encontrado" });
      return res.json({ message: "Evento atualizado" });
    } catch (error) {
      console.error("Admin update event error:", error instanceof Error ? error.message : error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post("/admin/events/:eventId/recalculate", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const parsedId = UuidSchema.safeParse(req.params.eventId);
    if (!parsedId.success) return res.status(404).json({ error: "Evento não encontrado" });
    await recalculateLeaderboard(parsedId.data);
    return res.json({ message: "Leaderboard recalculado" });
  } catch (error) {
    console.error("Admin recalculate error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/events/:eventId/distribute-rewards", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const parsedId = UuidSchema.safeParse(req.params.eventId);
    if (!parsedId.success) return res.status(404).json({ error: "Evento não encontrado" });
    const rewards = await calculateEventRewards(parsedId.data);
    return res.json({
      message: `${rewards.length} recompensas emitidas`,
      rewards,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Admin distribute rewards error:", error instanceof Error ? error.message : error);
    if (message === "Evento não encontrado") return res.status(404).json({ error: message });
    if (message.includes("Leaderboard não calculado")) return res.status(409).json({ error: message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:eventId/rewards", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsedId = UuidSchema.safeParse(req.params.eventId);
    if (!parsedId.success) return res.status(404).json({ error: "Evento não encontrado" });
    if (!(await canViewEventStandings(req.user!, parsedId.data))) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const rewards = await db
      .select()
      .from(eventRewards)
      .where(eq(eventRewards.eventId, parsedId.data))
      .orderBy(asc(eventRewards.rank));
    return res.json(rewards);
  } catch (error) {
    console.error("Get event rewards error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const eventsRouter = router;
