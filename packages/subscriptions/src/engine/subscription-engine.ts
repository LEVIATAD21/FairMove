import { db, subscriptions, type Transaction } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  walletEngine,
  DuplicateOperationError,
  InsufficientFundsError,
} from "../../../wallets/src/engine/wallet-engine";
import { reserveEngine } from "../../../reserves/src/engine/reserve-engine";

export interface SubscriptionResult {
  success: boolean;
  subscriptionId?: string;
  message: string;
  status?: string;
  newReserveBalance?: number;
}

/** Preço da assinatura após o 1º mês: R$ 100,00. */
export const SUBSCRIPTION_PRICE_CENTS = 10_000;
/** Repartição: R$ 59,00 para a plataforma. */
export const PLATFORM_SHARE_CENTS = 5_900;
/** Repartição: R$ 41,00 para a reserva de emergência do motorista. */
export const RESERVE_SHARE_CENTS = 4_100;

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
      });
    }

    return {
      success: true,
      subscriptionId,
      status: "active",
      message:
        "Assinatura ativada. Primeiro mês grátis. A partir do 2º mês: R$ 100/mês (R$ 59 para plataforma + R$ 41 para reserva).",
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
   * Cobra a mensalidade (R$ 100):
   * - R$ 59 → carteira da plataforma
   * - R$ 41 → reserva de emergência do motorista
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
    const idempotencyKey = `subscription:${userId}:${periodKey(chargeDate)}`;
    const platformUserId = getPlatformUserId();

    try {
      const result = await db.transaction(async (tx: Transaction) => {
        // Débita R$ 100 da carteira do motorista
        await walletEngine.debitCents(
          userId,
          SUBSCRIPTION_PRICE_CENTS,
          {
            idempotencyKey: `${idempotencyKey}:debit`,
            description: "Mensalidade da assinatura FairMove",
            metadata: { subscriptionId: sub.id },
          },
          tx
        );

        // R$ 59 → plataforma
        await walletEngine.creditCents(
          platformUserId,
          PLATFORM_SHARE_CENTS,
          {
            idempotencyKey: `${idempotencyKey}:platform`,
            description: "Receita de assinatura (plataforma)",
            metadata: { subscriptionId: sub.id, userId },
          },
          tx
        );

        // R$ 41 → reserva do motorista (espelho na carteira)
        const reserveMove = await walletEngine.creditReserveCents(
          userId,
          RESERVE_SHARE_CENTS,
          {
            idempotencyKey: `${idempotencyKey}:reserve`,
            description: "Aporte da assinatura na reserva de emergência",
            metadata: { subscriptionId: sub.id },
          },
          tx
        );

        // …e nos buckets da reserva
        await reserveEngine.contributeToReserve(userId, RESERVE_SHARE_CENTS / 100, "emergency", tx);
        await reserveEngine.recordContribution(userId, RESERVE_SHARE_CENTS / 100, "emergency", tx, {
          ledgerTransactionId: reserveMove.transactionId,
        });

        // Estende o período coberto
        await tx
          .update(subscriptions)
          .set({
            currentPeriodStart: chargeDate,
            currentPeriodEnd: new Date(chargeDate.getTime() + 30 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, sub.id));

        return reserveMove;
      });

      return {
        success: true,
        subscriptionId: sub.id,
        status: "active",
        newReserveBalance: result.newReserveBalance,
        message:
          "Mensalidade cobrada. R$ 59 para a plataforma e R$ 41 adicionados à reserva de emergência.",
      };
    } catch (error) {
      if (error instanceof DuplicateOperationError) {
        return {
          success: true,
          subscriptionId: sub.id,
          status: "active",
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
