import { db } from "../db";
import { subscriptions, users, emergency_reserves } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { walletEngine } from "../wallets/engine/wallet-engine";
import { v4 as uuidv4 } from "uuid";

export interface SubscriptionResult {
  success: boolean;
  subscriptionId?: string;
  message: string;
  newReserveBalance?: number;
}

export class SubscriptionEngine {
  constructor(private db = db, private walletEngine = walletEngine) {}

  async getSubscription(userId: string) {
    const sub = db.select().from(subscriptions).where(
      eq(subscriptions.userId, userId)
    );
    return sub.length > 0 ? sub[0] : null;
  }

  async activateSubscription(userId: string, trialDays: number = 30): Promise<SubscriptionResult> {
    // Check if user already has an active subscription
    const existing = await this.getSubscription(userId);

    if (existing && existing.status === "active") {
      return { success: false, message: "Usuário já tem assinatura ativa" };
    }

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    const subscriptionId = uuidv4();

    if (existing) {
      // Update existing subscription
      await db.update(subscriptions).set({
        status: "active",
        plan: "pro",
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        cancelAt: false,
        updatedAt: new Date(),
      }).where(eq(subscriptions.userId, userId));
    } else {
      // Create new subscription
      await db.insert(subscriptions).values({
        id: subscriptionId,
        userId,
        status: "active",
        plan: "pro",
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      });
    }

    // Credit the driver's reserve with R$41 (platform share from subscription)
    // This happens after the first month - but for MVP, we'll do it immediately
    // Actually, according to the rules: first month is FREE, starting 2nd month is R$100
    // R$59 → platform, R$41 → reserve
    // For now, we'll just mark the subscription and not immediately charge

    return {
      success: true,
      subscriptionId,
      message: "Assinatura ativada. Primeiro mês grático. A partir do 2º mês: R$ 100/mês (R$ 59 para plataforma + R$ 41 para reserva).",
    };
  }

  async cancelSubscription(userId: string): Promise<SubscriptionResult> {
    const existing = await this.getSubscription(userId);

    if (!existing || existing.status === "cancelled") {
      return { success: false, message: "Assinatura não encontrada ou já cancelada" };
    }

    await db.update(subscriptions).set({
      status: "cancelled",
      canceledAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(subscriptions.userId, userId));

    return { success: true, message: "Assinatura cancelada com sucesso" };
  }

  async checkTrialExpiration(userId: string): Promise<{
    trialExpires: boolean;
    daysRemaining: number;
    shouldCharge: boolean;
  }> {
    const sub = await this.getSubscription(userId);

    if (!sub) {
      return { trialExpires: false, daysRemaining: 0, shouldCharge: false };
    }

    const now = new Date();
    const daysRemaining = Math.max(
      0,
      Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );

    const shouldCharge = daysRemaining <= 0 && sub.status === "active";

    return {
      trialExpires: shouldCharge,
      daysRemaining,
      shouldCharge,
    };
  }

  async chargeMonthlyFee(userId: string): Promise<SubscriptionResult> {
    // Check if we should charge (only starting 2nd month)
    const trialCheck = await this.checkTrialExpiration(userId);

    if (!trialCheck.shouldCharge) {
      return {
        success: false,
        message: "Não é hora de cobrar a assinatura ainda (ainda no mês grátis)",
      };
    }

    // According to the rules:
    // R$100/mês total
    // R$59 → plataforma
    // R$41 → reserva de emergência do motorista

    // First, credit the reserve with R$41
    const reserveResult = await this.walletEngine.contributeToReserve(
      userId,
      41,
      "subscription_monthly"
    );

    // The remaining R$59 would go to platform revenue (not tracked in wallet)
    // For now, we just record the reserve contribution

    // Update subscription current period end
    await db.update(subscriptions).set({
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(subscriptions.userId, userId));

    return {
      success: true,
      message: "Taxa de assinatura mensal cobrada. R$ 41 adicionados à reserva de emergência.",
      newReserveBalance: reserveResult.newReserveBalance,
    };
  }
}

export const subscriptionEngine = new SubscriptionEngine();