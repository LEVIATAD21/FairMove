import { db, campaigns, coupons, promotion_redemptions, rides } from "@fairmove/shared-db";
import type { Executor } from "@fairmove/shared-db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

/** Claim de limite perdido por concorrência — dispara rollback da transação. */
export class CouponExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouponExhaustedError";
  }
}

export interface CouponCampaign {
  id: string;
  discount_type: string;
  discount_value: number;
  is_active: boolean;
  max_uses: number | null;
  uses_count: number;
  start_date: Date | null;
  end_date: Date | null;
}

export interface CouponRow {
  id: string;
  code: string;
  campaignId: string | null;
  discount_value: number;
  is_single_use: boolean;
  is_active: boolean;
  max_uses: number | null;
  uses_count: number;
  expires_at: Date | null;
}

export interface CouponEvaluation {
  valid: boolean;
  reason?: string;
  discountCents: number;
  coupon?: CouponRow;
  campaign?: CouponCampaign | null;
}

export interface PromotionResult {
  discountApplied: boolean;
  /** Desconto em centavos. */
  discountCents: number;
  /** Preço final em centavos. */
  finalPriceCents: number;
  /** Crédito do motorista em centavos (regra: === preço final). */
  driverCreditCents: number;
  redemptionId?: string;
}

/**
 * Calcula o desconto em centavos a partir do cupom e da campanha.
 * - percent: `discount_value` é a porcentagem (ex.: 10 = 10%)
 * - fixed: `discount_value` já está em centavos
 * O desconto é limitado ao preço da corrida.
 */
export function computeDiscountCents(
  campaign: CouponCampaign | null | undefined,
  couponValueCents: number,
  priceCents: number
): number {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return 0;

  let discount = 0;
  if (campaign && campaign.discount_type === "percent") {
    const percent = Math.min(Math.max(campaign.discount_value, 0), 100);
    discount = Math.round((priceCents * percent) / 100);
  } else if (campaign) {
    discount = campaign.discount_value;
  } else {
    discount = couponValueCents;
  }

  if (!Number.isFinite(discount) || discount < 0) discount = 0;
  return Math.min(discount, priceCents);
}

function isCampaignWindowOpen(campaign: CouponCampaign | null | undefined, now = new Date()): boolean {
  if (!campaign) return true;
  if (!campaign.is_active) return false;
  if (campaign.start_date && new Date(campaign.start_date) > now) return false;
  if (campaign.end_date && new Date(campaign.end_date) < now) return false;
  if (campaign.max_uses != null && campaign.uses_count >= campaign.max_uses) return false;
  return true;
}

/** Valida um cupom contra o preço informado, sem escrever nada no banco. */
export async function evaluateCoupon(
  couponCode: string,
  passengerId: string,
  priceCents: number
): Promise<CouponEvaluation> {
  const code = couponCode.trim().toUpperCase();

  const rows = await db
    .select({ coupon: coupons, campaign: campaigns })
    .from(coupons)
    .leftJoin(campaigns, eq(coupons.campaignId, campaigns.id))
    .where(eq(coupons.code, code));

  if (rows.length === 0) {
    return { valid: false, reason: "Cupom não encontrado", discountCents: 0 };
  }

  const coupon = rows[0].coupon;
  const campaign = rows[0].campaign;
  const now = new Date();

  if (!coupon.is_active) {
    return { valid: false, reason: "Cupom inativo", discountCents: 0, coupon, campaign };
  }

  if (coupon.expires_at && new Date(coupon.expires_at) < now) {
    return { valid: false, reason: "Cupom expirado", discountCents: 0, coupon, campaign };
  }

  if (!isCampaignWindowOpen(campaign, now)) {
    return { valid: false, reason: "Campanha inválida ou encerrada", discountCents: 0, coupon, campaign };
  }

  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
    return { valid: false, reason: "Cupom esgotado", discountCents: 0, coupon, campaign };
  }

  if (campaign && campaign.max_uses != null && campaign.uses_count >= campaign.max_uses) {
    // Limite da CAMPANHA (ex.: "100 cupons"): sem esta checagem o limite era
    // apenas informativo — evaluate nunca olhava uses_count da campanha.
    return { valid: false, reason: "Campanha esgotada", discountCents: 0, coupon, campaign };
  }

  if (coupon.is_single_use) {
    const used = await db
      .select({ id: promotion_redemptions.id })
      .from(promotion_redemptions)
      .where(
        and(
          eq(promotion_redemptions.couponId, coupon.id),
          eq(promotion_redemptions.passengerId, passengerId)
        )
      )
      .limit(1);

    if (used.length > 0) {
      return {
        valid: false,
        reason: "Cupom já utilizado por este passageiro",
        discountCents: 0,
        coupon,
        campaign,
      };
    }
  }

  const discountCents = computeDiscountCents(campaign, coupon.discount_value, priceCents);
  if (discountCents <= 0) {
    return { valid: false, reason: "Cupom sem desconto aplicável", discountCents: 0, coupon, campaign };
  }

  return { valid: true, discountCents, coupon, campaign };
}

/**
 * Consome o cupom de forma atômica (incremento condicional) e registra o
 * resgate. Retorna null quando o limite de uso foi atingido por concorrência.
 */
async function redeemCoupon(
  evaluation: CouponEvaluation,
  rideId: string,
  passengerId: string,
  exec: Executor
): Promise<string> {
  const coupon = evaluation.coupon!;
  // Claim ATÔMICO dos limites (campanha e cupom) + registro do resgate na
  // MESMA transação: duas requisições concorrentes não passam ambas pelo
  // "uses_count < max_uses" (o evaluate é só preflight; quem garante é aqui).
  if (evaluation.campaign) {
    const claimed = await exec
      .update(campaigns)
      .set({
        uses_count: sql`${campaigns.uses_count} + 1`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(campaigns.id, evaluation.campaign.id),
          sql`(${campaigns.max_uses} IS NULL OR ${campaigns.uses_count} < ${campaigns.max_uses})`
        )
      )
      .returning({ id: campaigns.id });
    if (claimed.length === 0) {
      // Estouro por concorrência — rollback total (cupom e redemption intactos).
      throw new CouponExhaustedError("Campanha esgotada");
    }
  }

  const updated = await exec
    .update(coupons)
    .set({
      uses_count: sql`${coupons.uses_count} + 1`,
      times_used: sql`${coupons.times_used} + 1`,
    })
    .where(
      and(eq(coupons.id, coupon.id), sql`(${coupons.max_uses} IS NULL OR ${coupons.uses_count} < ${coupons.max_uses})`)
    )
    .returning({ id: coupons.id });

  if (updated.length === 0) {
    throw new CouponExhaustedError("Cupom esgotado");
  }

  const redemptionId = uuidv4();
  await exec.insert(promotion_redemptions).values({
    id: redemptionId,
    rideId,
    couponId: coupon.id,
    passengerId,
    redemption_code: coupon.code,
    amount_discounted: evaluation.discountCents,
  });

  return redemptionId;
}

const APPLICABLE_STATUSES = ["REQUESTED", "SEARCHING", "DRIVER_ASSIGNED"];

/**
 * Aplica um cupom a uma corrida e persiste o novo preço.
 * Idempotente por corrida: reaplicar o mesmo cupom não cobra em dobro.
 */
export async function applyPromotion(
  rideId: string,
  passengerId: string,
  couponCode?: string
): Promise<PromotionResult> {
  const rideRows = await db.select().from(rides).where(eq(rides.id, rideId));
  if (rideRows.length === 0) {
    throw Object.assign(new Error("Ride not found"), { statusCode: 404 });
  }
  const ride = rideRows[0];

  if (ride.passengerId !== passengerId) {
    throw Object.assign(new Error("Ride does not belong to this passenger"), { statusCode: 403 });
  }

  const originalPriceCents = Number(ride.finalPassengerPrice);

  if (!couponCode) {
    return {
      discountApplied: false,
      discountCents: 0,
      finalPriceCents: originalPriceCents,
      driverCreditCents: Number(ride.driverCredit),
    };
  }

  const existingRedemption = await db
    .select()
    .from(promotion_redemptions)
    .where(eq(promotion_redemptions.rideId, rideId))
    .limit(1);

  if (existingRedemption.length > 0) {
    const discountCents = Number(existingRedemption[0].amount_discounted);
    // ride.finalPassengerPrice/driverCredit JÁ contêm o desconto quando ele
    // foi persistido (promotionDiscount > 0). Recalcular "preço - desconto"
    // sobre o valor já líquido devolvia R$0 ao cliente — resposta mentirosa
    // que um app podia exibir/cobrar. O retorno reflete o estado real.
    const alreadyApplied = Number(ride.promotionDiscount ?? 0) > 0;
    const finalPriceCents = alreadyApplied
      ? originalPriceCents
      : Math.max(0, originalPriceCents - discountCents);
    return {
      discountApplied: discountCents > 0,
      discountCents,
      finalPriceCents,
      driverCreditCents: alreadyApplied ? Number(ride.driverCredit) : finalPriceCents,
      redemptionId: existingRedemption[0].id,
    };
  }

  const evaluation = await evaluateCoupon(couponCode, passengerId, originalPriceCents);
  if (!evaluation.valid) {
    throw Object.assign(new Error(evaluation.reason || "Cupom inválido"), { statusCode: 400 });
  }

  // BUG-F1: o resgate (uses_count++/redemption) SÓ pode acontecer dentro da
  // janela em que o preço será de fato atualizado. Antes de existir este gate
  // o cupom era queimado em corridas avançadas (DRIVER_ARRIVING, IN_PROGRESS…)
  // com o preço intacto — e a resposta ainda devolvia finalPrice descontado.
  if (!APPLICABLE_STATUSES.includes(ride.status)) {
    throw Object.assign(
      new Error(`Cupom não pode ser aplicado em corrida com status ${ride.status}`),
      { statusCode: 409 }
    );
  }

  const finalPriceCents = originalPriceCents - evaluation.discountCents;

  // Transação ÚNICA: resgate + persistência do preço. Se o update não achar
  // a corrida na janela aplicável (status mudou por concorrência), o throw
  // desfaz o resgate — nunca fica "cupom queimado sem desconto".
  let redemptionId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      redemptionId = await redeemCoupon(evaluation, rideId, passengerId, tx);

      const updatedRides = await tx
        .update(rides)
        .set({
          promotionDiscount: evaluation.discountCents,
          finalPassengerPrice: finalPriceCents,
          // Regra de negócio: motorista recebe o valor líquido pago pelo passageiro.
          driverCredit: finalPriceCents,
          updatedAt: new Date(),
        })
        .where(and(eq(rides.id, rideId), inArray(rides.status, APPLICABLE_STATUSES)))
        .returning({ id: rides.id });

      if (updatedRides.length === 0) {
        throw Object.assign(
          new Error(`Cupom não pode ser aplicado em corrida com status ${ride.status}`),
          { statusCode: 409 }
        );
      }
    });
  } catch (error) {
    if (error instanceof CouponExhaustedError) {
      throw Object.assign(new Error(error.message), { statusCode: 400 });
    }
    throw error;
  }
  if (!redemptionId) {
    throw Object.assign(new Error("Cupom esgotado"), { statusCode: 400 });
  }

  return {
    discountApplied: true,
    discountCents: evaluation.discountCents,
    finalPriceCents,
    driverCreditCents: finalPriceCents,
    redemptionId,
  };
}

export async function createCampaign(
  name: string,
  discountType: "percent" | "fixed",
  discountValue: number,
  targetType: "ride" | "user" | "region" | "category" = "ride",
  maxUses?: number,
  startDate?: Date,
  endDate?: Date,
  targetValue?: string,
  description?: string
): Promise<string> {
  if (discountType === "percent" && (discountValue <= 0 || discountValue > 100)) {
    throw Object.assign(new Error("Percent discount must be between 1 and 100"), {
      statusCode: 400,
    });
  }
  if (discountType === "fixed" && discountValue <= 0) {
    throw Object.assign(new Error("Fixed discount must be positive"), { statusCode: 400 });
  }
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    throw Object.assign(new Error("startDate must be before endDate"), { statusCode: 400 });
  }

  const id = uuidv4();
  await db.insert(campaigns).values({
    id,
    name,
    description,
    discount_type: discountType,
    discount_value: Math.round(discountValue),
    target_type: targetType,
    target_value: targetValue,
    max_uses: maxUses,
    start_date: startDate,
    end_date: endDate,
    is_active: true,
  });

  return id;
}

export async function generateCouponCode(campaignId: string): Promise<string> {
  const campaign = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (campaign.length === 0) {
    throw Object.assign(new Error("Campaign not found"), { statusCode: 404 });
  }

  const code = `FAIR${uuidv4().replace(/-/g, "").substring(0, 8).toUpperCase()}`;
  await db.insert(coupons).values({
    id: uuidv4(),
    code,
    campaignId,
    discount_value: 0,
    is_single_use: true,
    is_active: true,
  });

  return code;
}

/** Cancela os resgates de uma corrida (usado em cancelamento). */
export async function releaseRedemptions(rideId: string): Promise<void> {
  const redemptions = await db
    .select()
    .from(promotion_redemptions)
    .where(eq(promotion_redemptions.rideId, rideId));

  if (redemptions.length === 0) return;

  const couponIds: string[] = [
    ...new Set(
      redemptions
        .map((r: { couponId: string | null }) => r.couponId)
        .filter((id: string | null): id is string => Boolean(id))
    ),
  ];

  await db.delete(promotion_redemptions).where(eq(promotion_redemptions.rideId, rideId));

  if (couponIds.length > 0) {
    await db
      .update(coupons)
      .set({
        uses_count: sql`GREATEST(${coupons.uses_count} - 1, 0)`,
        times_used: sql`GREATEST(${coupons.times_used} - 1, 0)`,
      })
      .where(inArray(coupons.id, couponIds));
  }
}
