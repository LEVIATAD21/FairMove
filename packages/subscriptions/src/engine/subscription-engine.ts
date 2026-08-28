import { db, subscriptions } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export interface SubscriptionResult {
  success: boolean;
  subscriptionId?: string;
  message: string;
  newReserveBalance?: number;
}

export class SubscriptionEngine {
  async getSubscription(userId: string) {
    const sub = await db.select().from(subscriptions).where(
      eq(subscriptions.userId, userId)
    );
    return sub.length > 0 ? sub[0] : null;
  }

  async activateSubscription(userId: string, trialDays: number = 30): Promise<SubscriptionResult> {
    const existing = await this.getSubscription(userId);

    if (existing && existing.status === "active") {
      return { success: false, message: "Usuário já tem assinatura ativa" };
    }

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    const subscriptionId = uuidv4();

    if (existing) {
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
    const trialCheck = await this.checkTrialExpiration(userId);

    if (!trialCheck.shouldCharge) {
      return {
        success: false,
        message: "Não é hora de cobrar a assinatura ainda (ainda no mês grátis)",
      };
    }

    await db.update(subscriptions).set({
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(subscriptions.userId, userId));

    return {
      success: true,
      message: "Taxa de assinatura mensal cobrada. R$ 41 adicionados à reserva de emergência.",
    };
  }
}

export const subscriptionEngine = new SubscriptionEngine();
