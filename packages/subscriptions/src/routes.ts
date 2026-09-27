import { Router, type Request, type Response } from "express";
import { requireAuth, requireSelfOrRole } from "../../auth/src/middleware";
import { subscriptionEngine } from "./engine/subscription-engine";

const router = Router();

/** Rota própria (ou admin) — `:userId` precisa ser o usuário autenticado. */
router.get("/:userId", requireAuth, requireSelfOrRole("userId", "admin"), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };

    const subscription = await subscriptionEngine.getSubscription(userId);

    if (!subscription) {
      return res.json({ hasSubscription: false, status: "none" });
    }

    return res.json({
      hasSubscription: true,
      subscription,
    });
  } catch (error) {
    console.error("Get subscription error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Ativar assinatura (trial) — próprio usuário
router.post("/:userId/activate", requireAuth, requireSelfOrRole("userId", "admin"), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };

    const result = await subscriptionEngine.activateSubscription(userId);

    return res.json(result);
  } catch (error) {
    console.error("Activate subscription error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Opt-out da Reserva de Disciplina (irreversível) — próprio usuário
router.post("/:userId/opt-out", requireAuth, requireSelfOrRole("userId", "admin"), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };

    const result = await subscriptionEngine.optOutOfReserve(userId);

    if (!result.success && result.status === "none") {
      return res.status(404).json({ error: result.message });
    }
    if (!result.success) {
      // Já aplicado — idempotente para a UI, mas sinaliza o estado real.
      return res.status(409).json({ error: result.message, optedOutOfReserve: true });
    }

    return res.json({ optedOutOfReserve: true, subscriptionId: result.subscriptionId });
  } catch (error) {
    console.error("Opt-out reserve error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Cancelar assinatura — próprio usuário
router.post("/:userId/cancel", requireAuth, requireSelfOrRole("userId", "admin"), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };

    const result = await subscriptionEngine.cancelSubscription(userId);

    return res.json(result);
  } catch (error) {
    console.error("Cancel subscription error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Verificar expiração do trial — próprio usuário
router.post("/:userId/trial-status", requireAuth, requireSelfOrRole("userId", "admin"), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };

    const result = await subscriptionEngine.checkTrialExpiration(userId);

    return res.json(result);
  } catch (error) {
    console.error("Check trial status error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Cobrança mensal — disparada apenas por administrador/sistema
router.post("/:userId/charge", requireAuth, requireSelfOrRole("userId", "admin"), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };

    const result = await subscriptionEngine.chargeMonthlyFee(userId);

    return res.json(result);
  } catch (error) {
    console.error("Charge monthly fee error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const subscriptionRouter = router;
