/**
 * Race de cupom: limite max_uses da CAMPANHA era apenas informativo
 * (duas requisições concorrentes passavam ambas e uses_count chegava a2
 * com maxUses=1). Correção: preflight em evaluateCoupon + claim atômico
 * condicional em redeemCoupon na MESMA transação (CouponExhaustedError).
 *
 * Cobre também a honestidade da resposta ao reaplicar cupom (antes
 * recalculava sobre o preço já líquido e devolvia finalPrice R$0).
 * Requer DATABASE_URL.
 */
import "dotenv/config";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

import express from "express";
import request from "supertest";
import { createHash, randomUUID } from "crypto";
import { sign } from "jsonwebtoken";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  users,
  sessions,
  rides,
  rideLocationEvents,
  campaigns,
  coupons,
  promotion_redemptions,
} from "../../packages/shared-db/src/index";
import {
  getJwtSecret,
} from "../../packages/auth/src/middleware";
import { rideRouter } from "../../packages/rides/src/routes";
import { promotionRouter } from "../../packages/promotions/src/routes";
import {
  createCampaign,
  generateCouponCode,
} from "../../packages/promotions/src/engine/promotion-engine";

const app = express();
app.use(express.json());
app.use("/api/rides", rideRouter);
app.use("/api/promotions", promotionRouter);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface Actor {
  id: string;
  sessionId: string;
  token: string;
}

async function makeActor(): Promise<Actor> {
  const id = randomUUID();
  const sessionId = randomUUID();
  await db.insert(users).values({
    id,
    name: "Cupom Racer",
    email: `coupon-${id}@sec.it`,
    passwordHash: "x",
    role: "passenger",
  });
  await db.insert(sessions).values({
    id: sessionId,
    userId: id,
    role: "passenger",
    token: sha256(`placeholder-${sessionId}`),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  const token = sign(
    { userId: id, role: "passenger", sessionId, jti: randomUUID() },
    getJwtSecret(),
    { expiresIn: "15m", algorithm: "HS256" }
  );
  return { id, sessionId, token };
}

const PICKUP = { lat: -23.5505, lng: -46.6333 };
const DROPOFF = { lat: -23.5505, lng: -46.6107 };

async function createRide(actor: Actor): Promise<string> {
  const res = await request(app)
    .post("/api/rides")
    .set("Authorization", `Bearer ${actor.token}`)
    .send({
      pickupLocationLat: PICKUP.lat,
      pickupLocationLng: PICKUP.lng,
      dropoffLocationLat: DROPOFF.lat,
      dropoffLocationLng: DROPOFF.lng,
    });
  expect(res.status).toBe(201);
  return res.body.rideId as string;
}

describeIfDb("security: race de cupom (limite da campanha)", () => {
  const createdUserIds: string[] = [];
  const createdCampaignIds: string[] = [];

  afterAll(async () => {
    if (createdCampaignIds.length > 0) {
      const couponRows = await db
        .select({ id: coupons.id })
        .from(coupons)
        .where(inArray(coupons.campaignId, createdCampaignIds));
      const couponIds = couponRows.map((c) => c.id);
      if (couponIds.length > 0) {
        await db
          .delete(promotion_redemptions)
          .where(inArray(promotion_redemptions.couponId, couponIds));
        await db.delete(coupons).where(inArray(coupons.id, couponIds));
      }
      await db.delete(campaigns).where(inArray(campaigns.id, createdCampaignIds));
    }
    if (createdUserIds.length > 0) {
      const rideRows = await db
        .select({ id: rides.id })
        .from(rides)
        .where(inArray(rides.passengerId, createdUserIds));
      const rideIds = rideRows.map((r) => r.id);
      if (rideIds.length > 0) {
        await db.delete(rideLocationEvents).where(inArray(rideLocationEvents.rideId, rideIds));
        await db.delete(rides).where(inArray(rides.id, rideIds));
      }
      await db.delete(sessions).where(inArray(sessions.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  it("dois usuários aplicando o mesmo cupom (maxUses=1) em paralelo → exatamente 1 vence", async () => {
    const a = await makeActor();
    const b = await makeActor();
    createdUserIds.push(a.id, b.id);

    const rideA = await createRide(a);
    const rideB = await createRide(b);

    const campaignId = await createCampaign(
      `RT race ${Date.now()}`,
      "fixed",
      500,
      "ride",
      1 // limite total da campanha: UMA uso
    );
    createdCampaignIds.push(campaignId);
    const code = await generateCouponCode(campaignId);
    const couponRows = await db
      .select({ id: coupons.id })
      .from(coupons)
      .where(eq(coupons.code, code));

    const [resA, resB] = await Promise.all([
      request(app)
        .post("/api/promotions/apply")
        .set("Authorization", `Bearer ${a.token}`)
        .send({ rideId: rideA, couponCode: code }),
      request(app)
        .post("/api/promotions/apply")
        .set("Authorization", `Bearer ${b.token}`)
        .send({ rideId: rideB, couponCode: code }),
    ]);

    const statuses = [resA.status, resB.status];
    expect(statuses).not.toContain(500);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(1);

    const winner = resA.status === 200 ? resA : resB;
    expect(winner.body.discountApplied).toBe(true);
    expect(winner.body.discount).toBeGreaterThan(0);

    // Estado: campanha exatamente1 uso, exatamente1 redemption.
    const campaignRows = await db
      .select({ uses_count: campaigns.uses_count })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    expect(Number(campaignRows[0].uses_count)).toBe(1);

    const redemptions = await db
      .select({ id: promotion_redemptions.id })
      .from(promotion_redemptions)
      .where(eq(promotion_redemptions.couponId, couponRows[0].id));
    expect(redemptions).toHaveLength(1);
  });

  it("reaplicar cupom na mesma corrida → resposta honesta (não finalPrice 0)", async () => {
    const a = await makeActor();
    createdUserIds.push(a.id);
    const rideId = await createRide(a);

    const campaignId = await createCampaign(
      `RT replay ${Date.now()}`,
      "fixed",
      500,
      "ride",
      10
    );
    createdCampaignIds.push(campaignId);
    const code = await generateCouponCode(campaignId);

    const first = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ rideId, couponCode: code });
    expect(first.status).toBe(200);
    expect(first.body.discountApplied).toBe(true);

    const second = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ rideId, couponCode: code });
    expect(second.status).toBe(200);

    // O estado persistido é a fonte da verdade: preço final real da corrida.
    const rideRows = await db
      .select({
        finalPassengerPrice: rides.finalPassengerPrice,
        promotionDiscount: rides.promotionDiscount,
      })
      .from(rides)
      .where(eq(rides.id, rideId));
    const expectedFinal = Number(rideRows[0].finalPassengerPrice) / 100;
    expect(Number(rideRows[0].promotionDiscount)).toBeGreaterThan(0);
    expect(second.body.finalPrice).toBeCloseTo(expectedFinal, 2);
    expect(second.body.finalPrice).toBeGreaterThan(0);
    expect(second.body.discountApplied).toBe(true);
    expect(second.body.discount).toBeGreaterThan(0);

    // Idempotência: só UM redemption para esta corrida.
    const redemptions = await db
      .select({ id: promotion_redemptions.id })
      .from(promotion_redemptions)
      .where(eq(promotion_redemptions.rideId, rideId));
    expect(redemptions).toHaveLength(1);
  });

  it("terceiro usuário (campanha esgotada) → 400 e nada muda", async () => {
    const a = await makeActor();
    const c = await makeActor();
    createdUserIds.push(a.id, c.id);

    const rideA = await createRide(a);
    const rideC = await createRide(c);

    const campaignId = await createCampaign(
      `RT exhausted ${Date.now()}`,
      "fixed",
      500,
      "ride",
      1
    );
    createdCampaignIds.push(campaignId);
    const code = await generateCouponCode(campaignId);

    const win = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${a.token}`)
      .send({ rideId: rideA, couponCode: code });
    expect(win.status).toBe(200);

    const lose = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${c.token}`)
      .send({ rideId: rideC, couponCode: code });
    expect(lose.status).toBe(400);
    expect(lose.body.error).toMatch(/esgotad|inválida|encerrada/i);

    const campaignRows = await db
      .select({ uses_count: campaigns.uses_count })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    expect(Number(campaignRows[0].uses_count)).toBe(1);
  });
});
