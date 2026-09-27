/**
 * Guard de trial da assinatura: cancel -> activate NAO concede trial novo
 * (bug original: trialEndsAt e currentBillingCycle resetavam a cada
 * reativacao — mensalidade nunca era cobrada).
 */
import "dotenv/config";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, subscriptions } from "../packages/shared-db/src/index";
import { SubscriptionEngine } from "../packages/subscriptions/src/engine/subscription-engine";

describeIfDb("subscriptions: anti-loop de trial", () => {
  const engine = new SubscriptionEngine();
  const userId = `it-trial-${randomUUID()}`;

  afterAll(async () => {
    await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
  });

  it("primeira ativacao concede trial de 30 dias", async () => {
    const result = await engine.activateSubscription(userId);
    expect(result.success).toBe(true);

    const sub = await engine.getSubscription(userId);
    expect(sub).not.toBeNull();
    expect(sub!.status).toBe("active");
    expect(sub!.trialEndsAt).not.toBeNull();
    expect(sub!.subscriptionStartedAt).not.toBeNull();
  });

  it("cancel -> activate preserva trialEndsAt e subscriptionStartedAt (sem trial novo)", async () => {
    const before = await engine.getSubscription(userId);
    expect(before).not.toBeNull();

    const cancel = await engine.cancelSubscription(userId);
    expect(cancel.success).toBe(true);

    const reactivate = await engine.activateSubscription(userId);
    expect(reactivate.success).toBe(true);

    const after = await engine.getSubscription(userId);
    expect(after).not.toBeNull();
    // Trial NAO estendido: mesmo timestamp da primeira ativacao.
    expect(new Date(after!.trialEndsAt!).getTime()).toBe(
      new Date(before!.trialEndsAt!).getTime()
    );
    expect(new Date(after!.subscriptionStartedAt!).getTime()).toBe(
      new Date(before!.subscriptionStartedAt!).getTime()
    );
  });

  it("trial ja expirado: reativacao mantem shouldCharge=true apos fim do periodo", async () => {
    // Forca um trial vencido para provar que a cobranca volta a valer.
    await db
      .update(subscriptions)
      .set({
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        currentPeriodStart: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      })
      .where(eq(subscriptions.userId, userId));

    const cancel = await engine.cancelSubscription(userId);
    expect(cancel.success).toBe(true);
    const reactivate = await engine.activateSubscription(userId);
    expect(reactivate.success).toBe(true);

    const after = await engine.getSubscription(userId);
    // Trial vencido NAO volta a ser futuro.
    expect(new Date(after!.trialEndsAt!).getTime()).toBeLessThan(Date.now());

    const check = await engine.checkTrialExpiration(userId);
    expect(check.shouldCharge).toBe(true);
  });
});
