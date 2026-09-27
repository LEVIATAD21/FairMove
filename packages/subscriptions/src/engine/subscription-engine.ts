import { db, subscriptions, drivers, eventRewards, type Transaction } from "@fairmove/shared-db";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  walletEngine,
  DuplicateOperationError,
  InsufficientFundsError,
} from "../../../wallets/src/engine/wallet-engine";
import { reserveEngine } from "../../../reserves/src/engine/reserve-engine";
import { calculateMonthlyFee, resolveMonthsActive } from "./billing-calculator";

export interface SubscriptionResult {
  success: boolean;
  subscriptionId?: string;
  message: string;
  status?: string;
  newReserveBalance?: number;
  /** Faixa de cobrança aplicada (trial/standard/full/optOut) — útil para logs e UI. */
  tier?: string;
  /** Mensalidade cobrada no ciclo (centavos). */
  amountChargedCents?: number;
}

export function getPlatformUserId(): string {
  return process.env.PLATFORM_USER_ID || "platform";
}

function periodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export class SubscriptionEngine {
  async getSubscription(userId: string) {
    const sub = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    return sub.length > 0 ? sub[0] : null;
  }

  async activateSubscription(userId: string, trialDays: number = 30): Promise<SubscriptionResult> {
    const existing = await this.getSubscription(userId);

    if (existing && existing.status === "active") {
      return {
        success: false,
        subscriptionId: existing.id,
        status: existing.status,
        message: "Usuário já tem assinatura ativa",
      };
    }

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    let subscriptionId: string;

    if (existing) {
      subscriptionId = existing.id;
      await db
        .update(subscriptions)
        .set({
          status: "active",
          plan: "pro",
          trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd,
          cancelAt: false,
          canceledAt: null,
          subscriptionStartedAt: existing.subscriptionStartedAt ?? now,
          currentBillingCycle: 1,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.userId, userId));
    } else {
      subscriptionId = uuidv4();
      await db.insert(subscriptions).values({
        id: subscriptionId,
        userId,
        status: "active",
        plan: "pro",
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd,
        subscriptionStartedAt: now,
        currentBillingCycle: 1,
      });
    }

    return {
      success: true,
      subscriptionId,
      status: "active",
      message:
        "Assinatura ativada. Mês 1 grátis. Mês 2: R$ 100,00 (R$ 51,00 plataforma + R$ 49,00 reserva). Mês 3+: R$ 200,00 (R$ 130,00 + R$ 70,00).",
    };
  }

  /**
   * Opt-out da Reserva de Disciplina — IRREVERSÍVEL por regra de negócio.
   * Marca `optedOutOfReserve=true`; `calculateMonthlyFee` já lê o campo e
   * passa a cobrar o fixo integral da plataforma (sem aportes na reserva).
   */
  async optOutOfReserve(userId: string): Promise<SubscriptionResult> {
    const existing = await this.getSubscription(userId);
    if (!existing) {
      return { success: false, status: "none", message: "Nenhuma assinatura para este usuário" };
    }
    if (existing.optedOutOfReserve) {
      return {
        success: false,
        subscriptionId: existing.id,
        status: existing.status,
        message: "Opt-out já aplicado (operação irreversível)",
      };
    }
    await db
      .update(subscriptions)
      .set({ optedOutOfReserve: true, updatedAt: new Date() })
      .where(eq(subscriptions.id, existing.id));
    return {
      success: true,
      subscriptionId: existing.id,
      status: existing.status,
      message:
        "Opt-out aplicado: reserva congelada e mensalidade fixa integralmente para a plataforma (irreversível).",
    };
  }

  async cancelSubscription(userId: string): Promise<SubscriptionResult> {
    const existing = await this.getSubscription(userId);

    if (!existing || existing.status === "cancelled") {
      return { success: false, message: "Assinatura não encontrada ou já cancelada" };
    }

    await db
      .update(subscriptions)
      .set({
        status: "cancelled",
        cancelAt: true,
        canceledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, userId));

    return { success: true, status: "cancelled", message: "Assinatura cancelada com sucesso" };
  }

  async checkTrialExpiration(userId: string): Promise<{
    trialExpires: boolean;
    daysRemaining: number;
    shouldCharge: boolean;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
  }> {
    const sub = await this.getSubscription(userId);

    if (!sub || sub.status !== "active") {
      return {
        trialExpires: false,
        daysRemaining: 0,
        shouldCharge: false,
        trialEndsAt: null,
        currentPeriodEnd: null,
      };
    }

    const now = new Date();
    const trialEndsAt = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const currentPeriodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;

    const reference = trialEndsAt ?? currentPeriodEnd;
    const daysRemaining = reference
      ? Math.max(0, Math.ceil((reference.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    const trialOver = !trialEndsAt || trialEndsAt.getTime() <= now.getTime();
    const periodOver = !currentPeriodEnd || currentPeriodEnd.getTime() <= now.getTime();

    return {
      trialExpires: trialOver && daysRemaining <= 0,
      daysRemaining,
      shouldCharge: trialOver && periodOver,
      trialEndsAt,
      currentPeriodEnd,
    };
  }

  /**
   * Resolve o maior cupom de desconto ativo do motorista (FairMove League).
   * Cupons vencem após `durationMonths` a partir da emissão. Retorna 0 quando
   * não há cupom vigente.
   */
  private async resolveActiveDiscountPercent(userId: string, now: Date): Promise<number> {
    const driverRows = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(eq(drivers.userId, userId))
      .limit(1);
    if (driverRows.length === 0) return 0;

    const coupons = await db
      .select()
      .from(eventRewards)
      .where(
        and(eq(eventRewards.driverId, driverRows[0].id), eq(eventRewards.rewardType, "discount_coupon"))
      );

    let best = 0;
    for (const coupon of coupons) {
      const issuedAt = new Date(coupon.createdAt);
      const expiresAt = new Date(issuedAt);
      expiresAt.setMonth(expiresAt.getMonth() + (coupon.durationMonths ?? 1));
      if (now >= issuedAt && now < expiresAt) {
        best = Math.max(best, coupon.discountPercent ?? 0);
      }
    }
    return best;
  }

  /**
   * Cobra a mensalidade progressiva:
   * - Mês 1: R$ 0,00 (trial) — apenas estende o período.
   * - Mês 2: R$ 100,00 (R$ 51,00 plataforma + R$ 49,00 reserva).
   * - Mês 3+: R$ 200,00 (R$ 130,00 plataforma + R$ 70,00 reserva).
   * - Opt-out da reserva: R$ 150,00 fixos, 100% plataforma.
   * - Cupons FairMove League descontam SOMENTE da fatia da plataforma.
   *
   * Idempotente por período de cobrança; se o saldo do motorista não cobre a
   * mensalidade, a assinatura vai para `past_due` e nada é cobrado.
   */
  async chargeMonthlyFee(userId: string): Promise<SubscriptionResult> {
    const sub = await this.getSubscription(userId);
    if (!sub || sub.status !== "active") {
      return { success: false, message: "Assinatura ativa não encontrada" };
    }

    const trialCheck = await this.checkTrialExpiration(userId);
    if (!trialCheck.shouldCharge) {
      return {
        success: false,
        subscriptionId: sub.id,
        message: "Não é hora de cobrar a assinatura ainda (mês em curso)",
      };
    }

    const chargeDate = new Date();
    const now = new Date();
    const monthsActive =
      resolveMonthsActive(sub.subscriptionStartedAt, now) || sub.currentBillingCycle || 1;
    const discountPercent = await this.resolveActiveDiscountPercent(userId, chargeDate);
    const fee = calculateMonthlyFee({
      monthsActive,
      optedOutOfReserve: sub.optedOutOfReserve,
      discountPercent,
    });

    // Mês 1 (trial) — nada a cobrar: apenas estende o período coberto.
    if (fee.totalFee === 0) {
      await db
        .update(subscriptions)
        .set({
          currentPeriodStart: chargeDate,
          currentPeriodEnd: new Date(chargeDate.getTime() + 30 * 24 * 60 * 60 * 1000),
          currentBillingCycle: monthsActive,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
      return {
        success: true,
        subscriptionId: sub.id,
        status: "active",
        tier: fee.tier,
        amountChargedCents: 0,
        message: "Mês 1 (trial): mensalidade de R$ 0,00. Período estendido.",
      };
    }

    const idempotencyKey = `subscription:${userId}:${periodKey(chargeDate)}`;
    const platformUserId = getPlatformUserId();

    try {
      const result = await db.transaction(async (tx: Transaction) => {
        let reserveBalance: number | undefined;

        // Débita a taxa total progressiva da carteira do motorista
        await walletEngine.debitCents(
          userId,
          fee.totalFee,
          {
            idempotencyKey: `${idempotencyKey}:debit`,
            description: `Mensalidade FairMove — mês ${monthsActive} (${fee.tier})`,
            metadata: { subscriptionId: sub.id, monthsActive, tier: fee.tier, discountPercent },
          },
          tx
        );

        // Parcela da plataforma (já líquida de cupom, quando houver)
        if (fee.platformShare > 0) {
          await walletEngine.creditCents(
            platformUserId,
            fee.platformShare,
            {
              idempotencyKey: `${idempotencyKey}:platform`,
              description: "Receita de assinatura (plataforma)",
              metadata: { subscriptionId: sub.id, userId, tier: fee.tier },
            },
            tx
          );
        }

        // Parcela da reserva — NUNCA reduzida por cupom; só existe sem opt-out
        if (fee.reserveShare > 0) {
          const reserveMove = await walletEngine.creditReserveCents(
            userId,
            fee.reserveShare,
            {
              idempotencyKey: `${idempotencyKey}:reserve`,
              description: "Aporte da assinatura na reserva de emergência",
              metadata: { subscriptionId: sub.id },
            },
            tx
          );

          // …e nos buckets da reserva
          await reserveEngine.contributeToReserve(userId, fee.reserveShare / 100, "emergency", tx);
          await reserveEngine.recordContribution(userId, fee.reserveShare / 100, "emergency", tx, {
            ledgerTransactionId: reserveMove.transactionId,
          });

          reserveBalance = reserveMove.newReserveBalance;
        }

        // Estende o período coberto e registra o ciclo faturado
        await tx
          .update(subscriptions)
          .set({
            currentPeriodStart: chargeDate,
            currentPeriodEnd: new Date(chargeDate.getTime() + 30 * 24 * 60 * 60 * 1000),
            currentBillingCycle: monthsActive,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, sub.id));

        return { newReserveBalance: reserveBalance };
      });

      return {
        success: true,
        subscriptionId: sub.id,
        status: "active",
        tier: fee.tier,
        amountChargedCents: fee.totalFee,
        newReserveBalance: result.newReserveBalance,
        message: `Mensalidade cobrada (mês ${monthsActive}): R$ ${(fee.totalFee / 100).toFixed(2)} — R$ ${(fee.platformShare / 100).toFixed(2)} plataforma, R$ ${(fee.reserveShare / 100).toFixed(2)} reserva.`,
      };
    } catch (error) {
      if (error instanceof DuplicateOperationError) {
        return {
          success: true,
          subscriptionId: sub.id,
          status: "active",
          tier: fee.tier,
          message: "Mensalidade já cobrada neste período.",
        };
      }

      if (error instanceof InsufficientFundsError) {
        await db
          .update(subscriptions)
          .set({ status: "past_due", updatedAt: new Date() })
          .where(eq(subscriptions.id, sub.id));

        return {
          success: false,
          subscriptionId: sub.id,
          status: "past_due",
          message: "Saldo insuficiente para cobrar a mensalidade. Assinatura em atraso.",
        };
      }

      throw error;
    }
  }
}

export const subscriptionEngine = new SubscriptionEngine();
