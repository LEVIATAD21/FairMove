import { Router, type Request, type Response } from "express";
import { db, campaigns } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../../auth/src/middleware";
import { validateBody, CampaignSchema } from "@fairmove/validation";
import { fromCents, toCents } from "@fairmove/shared-types";
import {
  applyPromotion,
  createCampaign,
  evaluateCoupon,
  generateCouponCode,
} from "./engine/promotion-engine";

const router = Router();

function statusFrom(error: unknown): number {
  const code = (error as { statusCode?: number })?.statusCode;
  return code && code >= 400 && code < 600 ? code : 500;
}

const PreviewSchema = z.object({
  code: z.string().trim().min(3).max(40),
  amount: z.coerce.number().positive().max(100_000_000),
});

const ApplySchema = z.object({
  rideId: z.string().uuid(),
  couponCode: z.string().trim().min(3).max(40),
});

// Pré-visualiza o desconto de um cupom, sem consumi-lo
router.post(
  "/preview",
  requireAuth,
  validateBody(PreviewSchema),
  async (req: Request, res: Response) => {
    try {
      const { code, amount } = req.body as { code: string; amount: number };
      const priceCents = toCents(amount);
      const evaluation = await evaluateCoupon(code, req.user!.id, priceCents);

      res.json({
        valid: evaluation.valid,
        reason: evaluation.reason,
        discount: fromCents(evaluation.discountCents),
        finalPrice: fromCents(Math.max(0, priceCents - evaluation.discountCents)),
        currency: "BRL",
      });
    } catch (error) {
      console.error("Preview promotion error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Aplica o cupom à corrida do usuário autenticado (persiste o novo preço)
async function applyHandler(req: Request, res: Response) {
  try {
    const { rideId, couponCode } = req.body as { rideId: string; couponCode: string };

    const result = await applyPromotion(rideId, req.user!.id, couponCode);

    res.json({
      discountApplied: result.discountApplied,
      discount: fromCents(result.discountCents),
      finalPrice: fromCents(result.finalPriceCents),
      driverCredit: fromCents(result.driverCreditCents),
      redemptionId: result.redemptionId,
      currency: "BRL",
    });
  } catch (error) {
    const status = statusFrom(error);
    if (status !== 500) {
      res.status(status).json({ error: (error as Error).message });
      return;
    }
    console.error("Apply promotion error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
}

router.post("/apply", requireAuth, validateBody(ApplySchema), applyHandler);

// Rota legada mantida com o mesmo comportamento correto
router.post(
  "/quote",
  requireAuth,
  validateBody(ApplySchema),
  applyHandler
);

// Criar campanha (admin)
router.post(
  "/campaign",
  requireRole("admin"),
  validateBody(CampaignSchema),
  async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const campaignId = await createCampaign(
        body.name,
        body.discountType,
        // "fixed" é informado em reais e guardado em centavos
        body.discountType === "fixed" ? toCents(body.discountValue) : body.discountValue,
        body.targetType ?? "ride",
        body.maxUses,
        body.startDate,
        body.endDate,
        body.targetValue,
        body.description
      );

      res.status(201).json({ campaignId });
    } catch (error) {
      const status = statusFrom(error);
      if (status !== 500) {
        res.status(status).json({ error: (error as Error).message });
        return;
      }
      console.error("Create campaign error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Gerar cupom de uma campanha (admin)
router.post(
  "/campaign/:campaignId/coupon",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params as { campaignId: string };
      const couponCode = await generateCouponCode(campaignId);
      res.status(201).json({ couponCode });
    } catch (error) {
      const status = statusFrom(error);
      if (status !== 500) {
        res.status(status).json({ error: (error as Error).message });
        return;
      }
      console.error("Generate coupon error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Listar campanhas ativas — admin: a lista traz alavancas de negócio
// (target_value, max_uses/uses_count, janelas) que não são de usuário final.
router.get("/campaigns", requireAuth, requireRole("admin"), async (_req: Request, res: Response) => {
  try {
    const allCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.is_active, true));
    res.json(allCampaigns);
  } catch (error) {
    console.error("Get campaigns error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

export const promotionRouter = router;
