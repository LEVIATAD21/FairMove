/**
 * QA AUDIT — Área 3: cálculos financeiros (execução real; gateway/PSP intocado).
 *
 * Bugs-alvo desta suíte (encontrados na auditoria):
 *  [BUG-F1] POST /promotions/apply resgata o cupom ANTES de checar o status
 *           da corrida: em DRIVER_ARRIVING/AT_PICKUP/ONBOARD/IN_PROGRESS o
 *           cupom é QUEIMADO (uses_count++, redemption) mas o preço da corrida
 *           NÃO é atualizado — e a resposta ainda mente com finalPrice
 *           descontado. O passageiro paga cheio e o cupom some.
 *  [BUG-F2] releaseRedemptions devolve só o contador do CUPOM, nunca o da
 *           CAMPANHA (uses_count) — cada corrida cancelada consome 1 vaga da
 *           campanha para sempre; com maxUses=N, N cancelamentos esgotam a
 *           campanha inteira com todos os cupons ainda "vazios".
 *
 * Também invariante: finalPassengerPrice = baseFare + distanceFare + timeFare
 * − promotionDiscount e driverCredit === finalPassengerPrice (regra de negócio
 * documentada em calculator.ts: sem comissão).
 *
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
  verificationTokens,
  drivers,
  vehicles,
  rides,
  rideLocationEvents,
  wallets,
  ledger_transactions,
  ledger_entries,
  coupons,
  campaigns,
  promotion_redemptions,
} from "../packages/shared-db/src/index";
import { walletEngine } from "../packages/wallets/src/engine/wallet-engine";
import { getJwtSecret } from "../packages/auth/src/middleware";
import { authRouter } from "../packages/auth/src/routes";
import { rideRouter } from "../packages/rides/src/routes";
import { promotionRouter } from "../packages/promotions/src/routes";
import { pricingRouter } from "../packages/pricing/src/routes";

const app = express();
app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/rides", rideRouter);
app.use("/api/promotions", promotionRouter);
app.use("/api/pricing", pricingRouter);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface TestActor {
  id: string;
  sessionId: string;
  token: string;
  email: string;
}

async function makeActor(role: string): Promise<TestActor> {
  const id = randomUUID();
  const email = `qa3-${role}-${id}@qa.it`;
  await db.insert(users).values({
    id,
    name: `QA3 ${role}`,
    email,
    passwordHash: "x",
    role,
  });
  const sessionId = randomUUID();
  await db.insert(sessions).values({
    id: sessionId,
    userId: id,
    role,
    token: sha256(`placeholder-${sessionId}`),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  const token = sign({ userId: id, role, sessionId, jti: randomUUID() }, getJwtSecret(), {
    expiresIn: "15m",
    algorithm: "HS256",
  });
  return { id, sessionId, token, email };
}

async function makeDriverOnline(): Promise<{
  actor: TestActor;
  driverId: string;
  vehicleId: string;
}> {
  const actor = await makeActor("driver");
  const vehicleId = randomUUID();
  await db.insert(vehicles).values({
    id: vehicleId,
    brand: "Test",
    model: "Model",
    year: 2024,
    plate: `QA3${vehicleId.slice(0, 6).toUpperCase()}`,
    vehicleType: "car",
  });
  const driverId = randomUUID();
  await db.insert(drivers).values({
    id: driverId,
    userId: actor.id,
    vehicleId,
    status: "online",
    available: true,
    currentLocationLat: "-23.5505",
    currentLocationLng: "-46.6333",
  });
  return { actor, driverId, vehicleId };
}

const PICKUP = { lat: -23.5505, lng: -46.6333 };
const DROPOFF = { lat: -23.5505, lng: -46.6107 };

async function createRide(actor: TestActor): Promise<string> {
  const res = await request(app)
    .post("/api/rides")
    .set("Authorization", `Bearer ${actor.token}`)
    .send({
      pickupLocationLat: PICKUP.lat,
      pickupLocationLng: PICKUP.lng,
      dropoffLocationLat: DROPOFF.lat + Math.random() * 0.001,
      dropoffLocationLng: DROPOFF.lng,
    });
  if (res.status !== 201) {
    console.log(`[createRide FAIL] status=${res.status} body=${JSON.stringify(res.body)}`);
  }
  expect(res.status).toBe(201);
  return res.body.rideId as string;
}

async function getCouponState(code: string): Promise<{ uses: number; campaignUses: number }> {
  const rows = await db
    .select({ uses: coupons.uses_count, campaignId: coupons.campaignId })
    .from(coupons)
    .where(eq(coupons.code, code));
  const campaignUses = rows[0].campaignId
    ? (
        await db
          .select({ uses: campaigns.uses_count })
          .from(campaigns)
          .where(eq(campaigns.id, rows[0].campaignId!))
      )[0]?.uses ?? 0
    : 0;
  return { uses: rows[0].uses, campaignUses };
}

async function getRidePrice(rideId: string): Promise<{ final: number; discount: number }> {
  const rows = await db
    .select({
      final: rides.finalPassengerPrice,
      discount: rides.promotionDiscount,
    })
    .from(rides)
    .where(eq(rides.id, rideId));
  return { final: Number(rows[0].final), discount: Number(rows[0].discount) };
}

const createdUserIds: string[] = [];
const createdDriverIds: string[] = [];
const createdVehicleIds: string[] = [];
const createdCampaignIds: string[] = [];
const createdCouponCodes: string[] = [];

async function makeCoupon(
  admin: TestActor,
  opts: { percent: number; maxUses: number }
): Promise<{ code: string; campaignId: string }> {
  const camp = await request(app)
    .post("/api/promotions/campaign")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({
      name: `QA3 campanha ${randomUUID().slice(0, 8)}`,
      discountType: "percent",
      discountValue: opts.percent,
      maxUses: opts.maxUses,
    });
  expect(camp.status).toBe(201);
  const gen = await request(app)
    .post(`/api/promotions/campaign/${camp.body.campaignId}/coupon`)
    .set("Authorization", `Bearer ${admin.token}`);
  expect(gen.status).toBe(201);
  createdCampaignIds.push(camp.body.campaignId as string);
  createdCouponCodes.push(gen.body.couponCode as string);
  return { code: gen.body.couponCode as string, campaignId: camp.body.campaignId as string };
}

describeIfDb("QA audit: cálculos financeiros", () => {
  let passenger: TestActor;
  let admin: TestActor;
  let driver: Awaited<ReturnType<typeof makeDriverOnline>>;

  beforeAll(async () => {
    passenger = await makeActor("passenger");
    admin = await makeActor("admin");
    createdUserIds.push(passenger.id, admin.id);
    driver = await makeDriverOnline();
    createdUserIds.push(driver.actor.id);
    createdDriverIds.push(driver.driverId);
    createdVehicleIds.push(driver.vehicleId);
    await walletEngine.ensureWallet(passenger.id);
    await walletEngine.creditCents(passenger.id, 2_000_000);
  });

  afterAll(async () => {
    if (createdCouponCodes.length > 0) {
      await db
        .delete(promotion_redemptions)
        .where(
          inArray(
            promotion_redemptions.couponId,
            (
              await db
                .select({ id: coupons.id })
                .from(coupons)
                .where(inArray(coupons.code, createdCouponCodes))
            ).map((c) => c.id)
          )
        );
    }
    if (createdCouponCodes.length > 0) {
      await db.delete(coupons).where(inArray(coupons.code, createdCouponCodes));
    }
    if (createdCampaignIds.length > 0) {
      await db.delete(campaigns).where(inArray(campaigns.id, createdCampaignIds));
    }
    if (createdUserIds.length > 0) {
      const rideRows = await db
        .select({ id: rides.id })
        .from(rides)
        .where(inArray(rides.passengerId, createdUserIds));
      const rideIds = rideRows.map((r) => r.id);
      if (rideIds.length > 0) {
        await db
          .delete(promotion_redemptions)
          .where(inArray(promotion_redemptions.rideId, rideIds));
        await db.delete(rideLocationEvents).where(inArray(rideLocationEvents.rideId, rideIds));
        await db.delete(rides).where(inArray(rides.id, rideIds));
      }
      const walletRows = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(inArray(wallets.userId, createdUserIds));
      const walletIds = walletRows.map((w) => w.id);
      if (walletIds.length > 0) {
        await db.delete(ledger_entries).where(inArray(ledger_entries.walletId, walletIds));
        await db
          .delete(ledger_transactions)
          .where(inArray(ledger_transactions.walletId, walletIds));
        await db.delete(wallets).where(inArray(wallets.id, walletIds));
      }
      await db.delete(verificationTokens).where(inArray(verificationTokens.userId, createdUserIds));
      await db.delete(sessions).where(inArray(sessions.userId, createdUserIds));
      await db.delete(drivers).where(inArray(drivers.userId, createdUserIds));
      await db.delete(vehicles).where(inArray(vehicles.id, createdVehicleIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(drivers).where(inArray(drivers.id, createdDriverIds));
    }
    if (createdVehicleIds.length > 0) {
      await db.delete(vehicles).where(inArray(vehicles.id, createdVehicleIds));
    }
  });

  test("[F-0] invariante: componentes somam o preço e driverCredit === preço", async () => {
    const rideId = await createRide(passenger);
    const rows = await db.select().from(rides).where(eq(rides.id, rideId));
    const ride = rows[0];
    const sum =
      Number(ride.baseFare) +
      Number(ride.distanceFare) +
      Number(ride.timeFare) -
      Number(ride.promotionDiscount);
    console.log(
      `[F-0] base=${ride.baseFare} dist=${ride.distanceFare} time=${ride.timeFare} ` +
        `desc=${ride.promotionDiscount} → soma=${sum} final=${ride.finalPassengerPrice}`
    );
    expect(Number(ride.finalPassengerPrice)).toBe(sum);
    expect(Number(ride.driverCredit)).toBe(Number(ride.finalPassengerPrice));

    // Quote da rota de pricing bate com a corrida (mesmas fórmulas).
    const quote = await request(app)
      .post("/api/pricing/quote")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({
        pickupLocationLat: PICKUP.lat,
        pickupLocationLng: PICKUP.lng,
        dropoffLocationLat: DROPOFF.lat,
        dropoffLocationLng: DROPOFF.lng,
      });
    expect(quote.status).toBe(201);
    expect(Math.round(quote.body.passengerPrice * 100)).toBe(Number(ride.finalPassengerPrice));

    const cancel = await request(app)
      .post(`/api/rides/${rideId}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reason: "fim do F-0" });
    expect(cancel.status).toBe(200);
  });

  test("[F-1] cupom em corrida avançada: NÃO pode ser resgatado sem desconto", async () => {
    const { code } = await makeCoupon(admin, { percent: 10, maxUses: 10 });

    // Corrida já com motorista a caminho (DRIVER_ARRIVING — fora da janela
    // APPLICABLE_STATUSES = REQUESTED/SEARCHING/DRIVER_ASSIGNED).
    const rideId = await createRide(passenger);
    await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver.actor.token}`);
    for (const status of ["DRIVER_ARRIVING"]) {
      const step = await request(app)
        .patch(`/api/rides/${rideId}/status`)
        .set("Authorization", `Bearer ${driver.actor.token}`)
        .send({ status });
      expect(step.status).toBe(200);
    }

    const before = await getCouponState(code);
    const priceBefore = await getRidePrice(rideId);

    const apply = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ rideId, couponCode: code });

    const after = await getCouponState(code);
    const priceAfter = await getRidePrice(rideId);
    console.log(
      `[F-1] apply@DRIVER_ARRIVING → status=${apply.status} ` +
        `discountApplied=${apply.body.discountApplied} finalPrice=${apply.body.finalPrice} | ` +
        `cupom uses ${before.uses}→${after.uses} | preço ${priceBefore.final}→${priceAfter.final}`
    );

    // Pós-fix: recusa clara, NADA consumido, preço intacto.
    expect(apply.status).toBe(409);
    expect(after.uses).toBe(before.uses);
    expect(priceAfter.final).toBe(priceBefore.final);

    // Encerra a corrida A para não bloquear o guard de corrida ativa.
    const cancelA = await request(app)
      .post(`/api/rides/${rideId}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reason: "fim do cenário A" });
    expect(cancelA.status).toBe(200);

    // Cenário feliz (janela válida): REQUESTED → 200 e preço reduzido.
    const rideId2 = await createRide(passenger);
    const price2Before = await getRidePrice(rideId2);
    const before2 = await getCouponState(code);
    const ok = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ rideId: rideId2, couponCode: code });
    expect(ok.status).toBe(200);
    const price2After = await getRidePrice(rideId2);
    const after2 = await getCouponState(code);
    expect(price2After.final).toBe(price2Before.final - Math.round((price2Before.final * 10) / 100));
    expect(after2.uses).toBe(before2.uses + 1);
    expect(after2.campaignUses).toBe(before2.campaignUses + 1);

    // Reaplicar é idempotente (não queima em dobro).
    const again = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ rideId: rideId2, couponCode: code });
    expect(again.status).toBe(200);
    const after3 = await getCouponState(code);
    expect(after3.uses).toBe(after2.uses);
    expect(after3.campaignUses).toBe(after2.campaignUses);

    // Cancelamento devolve cupom E campanha (BUG-F2).
    const cancel = await request(app)
      .post(`/api/rides/${rideId2}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reason: "fim do F-1" });
    expect(cancel.status).toBe(200);
    const released = await getCouponState(code);
    console.log(
      `[F-2] cancel devolve: cupom ${after3.uses}→${released.uses} ` +
        `campanha ${after3.campaignUses}→${released.campaignUses}`
    );
    expect(released.uses).toBe(before2.uses);
    expect(released.campaignUses).toBe(before2.campaignUses);
  });

  test("[F-2] campanha com limite não é esgotada por cancelamentos repetidos", async () => {
    const p2 = await makeActor("passenger");
    createdUserIds.push(p2.id);
    const maxUses = 2;
    const { code } = await makeCoupon(admin, { percent: 20, maxUses });
    const initial = await getCouponState(code);
    expect(initial.campaignUses).toBe(0);

    // maxUses ciclos de criar → aplicar → cancelar; com F2 o contador da
    // campanha só sobe e no ciclo (maxUses+1) o apply responde 400.
    for (let i = 1; i <= maxUses + 1; i++) {
      const rideId = await createRide(p2);
      const apply = await request(app)
        .post("/api/promotions/apply")
        .set("Authorization", `Bearer ${p2.token}`)
        .send({ rideId, couponCode: code });
      const cancel = await request(app)
        .post(`/api/rides/${rideId}/cancel`)
        .set("Authorization", `Bearer ${p2.token}`)
        .send({ reason: `ciclo ${i}` });
      const state = await getCouponState(code);
      console.log(
        `[F-2] ciclo ${i}: apply=${apply.status} cancel=${cancel.status} ` +
          `cupom.uses=${state.uses} campanha.uses=${state.campaignUses}/${maxUses}`
      );
      expect(cancel.status).toBe(200);
      expect(apply.status).toBe(200); // RED pré-fix: ciclo 3 → 400 "Campanha esgotada"
      expect(state.campaignUses).toBe(0); // RED pré-fix: sobe a cada ciclo
      expect(state.uses).toBe(0);
    }
  });

  test("[F-3] desconto percentual bate com o preço final (rounding)", async () => {
    const p3 = await makeActor("passenger");
    createdUserIds.push(p3.id);
    const { code } = await makeCoupon(admin, { percent: 15, maxUses: 1 });
    const rideId = await createRide(p3);
    const priceBefore = await getRidePrice(rideId);
    const expectedDiscount = Math.round((priceBefore.final * 15) / 100);

    const ok = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${p3.token}`)
      .send({ rideId, couponCode: code });
    expect(ok.status).toBe(200);
    const priceAfter = await getRidePrice(rideId);
    console.log(
      `[F-3] 15% de ${priceBefore.final} → desconto=${priceBefore.final - priceAfter.final} ` +
        `(esperado ${expectedDiscount}) final=${priceAfter.final}`
    );
    expect(priceBefore.final - priceAfter.final).toBe(expectedDiscount);
    const rows = await db
      .select({ d: rides.promotionDiscount, dc: rides.driverCredit, f: rides.finalPassengerPrice })
      .from(rides)
      .where(eq(rides.id, rideId));
    expect(Number(rows[0].d)).toBe(expectedDiscount);
    expect(Number(rows[0].dc)).toBe(Number(rows[0].f)); // motorista recebe o líquido

    const cancel = await request(app)
      .post(`/api/rides/${rideId}/cancel`)
      .set("Authorization", `Bearer ${p3.token}`)
      .send({ reason: "fim do F-3" });
    expect(cancel.status).toBe(200);
    // libera para não vazar uso em campanha maxUses=1
    const state = await getCouponState(code);
    expect(state.campaignUses).toBe(0);
  });
});
