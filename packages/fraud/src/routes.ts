import { Router, type Request, type Response } from "express";
import { db, fraud_events, risk_scores } from "@fairmove/shared-db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthUser } from "../../auth/src/middleware";
import { validateBody, FraudEventSchema } from "@fairmove/validation";
import { fraudEngine } from "./engine/fraud-engine";

const router = Router();

function isSelfOrAdmin(user: AuthUser, userId: string): boolean {
  return user.role === "admin" || user.id === userId;
}

/** Calcula (e persiste) o risco do usuário — operação administrativa. */
router.post("/risk/:userId", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };

    const result = await fraudEngine.calculateUserRisk(userId);

    return res.json(result);
  } catch (error) {
    console.error("Calculate user risk error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** Registra um evento de fraude — administrativo/sistema (o engine também grava internamente). */
router.post("/event", requireAuth, requireRole("admin"), validateBody(FraudEventSchema), async (req: Request, res: Response) => {
  try {
    const { userId, rideId, eventType, riskLevel, score, description, metadata } = req.body as {
      userId: string;
      rideId?: string | null;
      eventType: "device_risk" | "account_risk" | "behavioral_risk";
      riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      score: number;
      description: string;
      metadata?: Record<string, unknown>;
    };

    await fraudEngine.registerEvent(
      userId,
      rideId ?? null,
      eventType,
      riskLevel,
      score,
      description,
      metadata as Record<string, any> | undefined
    );

    return res.status(201).json({ message: "Evento de fraude registrado com sucesso" });
  } catch (error) {
    console.error("Register fraud event error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** Score de risco — o próprio usuário ou admin. */
router.get("/score/:userId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };
    const user = req.user!;

    if (!isSelfOrAdmin(user, userId)) {
      return res.status(403).json({ error: "You do not have access to this risk score" });
    }

    const existing = await db.select().from(risk_scores).where(eq(risk_scores.userId, userId));

    if (existing.length === 0) {
      return res.json({ hasScore: false });
    }

    // Internals antifraude (heurísticas, limiares30/70/90) só para admin —
    // para o próprio usuário, expor o mapa de regras ajuda a evadir detecção.
    if (user.role !== "admin") {
      const { calculationDetails: _details, ...publicScore } = existing[0];
      return res.json({ hasScore: true, score: publicScore });
    }
    return res.json({ hasScore: true, score: existing[0] });
  } catch (error) {
    console.error("Get risk score error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** Eventos de fraude — o próprio usuário (visibilidade reduzida) ou admin. */
router.get("/events/:userId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };
    const user = req.user!;

    if (!isSelfOrAdmin(user, userId)) {
      return res.status(403).json({ error: "You do not have access to these events" });
    }

    const events = await db
      .select()
      .from(fraud_events)
      .where(eq(fraud_events.userId, userId))
      .orderBy(desc(fraud_events.createdAt));

    // metadata/description contêm os detalhes das heurísticas que geraram o
    // evento — visíveis apenas para admin.
    if (user.role !== "admin") {
      return res.json(
        events.map(({ metadata: _m, description: _d, ...safe }) => safe)
      );
    }
    return res.json(events);
  } catch (error) {
    console.error("Get fraud events error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const fraudRouter = router;
