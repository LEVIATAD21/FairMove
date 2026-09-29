/**
 * QA AUDIT — Área 6: edge cases de validação (execução real).
 *
 * Bugs-alvo:
 *  [BUG-I1] LatSchema/LngSchema usavam z.coerce.number() puro: `null` → 0,
 *           `""` → 0 e `true` → 1 passavam pela validação. Um POST /rides com
 *           pickupLocationLat: null criava corrida na Ilha Nula (0,0); o
 *           motorista sumia do matching com location null; nearby aceitava
 *           lat vazio com 200.
 *  [BUG-I2] CampaignSchema: z.coerce.date().optional() NÃO ignora null —
 *           `endDate: null` virava 1970-01-01 e a campanha nascia com a
 *           janela já encerrada (cupom morto), comportamento típico de
 *           front-end que manda null em campo de data vazio.
 *
 * Guardas (já corretas, proteção de regressão): amount null/abc → 400,
 * senha sem número → 400, chave desconhecida em profile (strict) → 400,
 * startDate > endDate → 400.
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
  campaigns,
  coupons,
  promotion_redemptions,
} from "../packages/shared-db/src/index";
import { walletEngine } from "../packages/wallets/src/engine/wallet-engine";
import { getJwtSecret } from "../packages/auth/src/middleware";
import { authRouter } from "../packages/auth/src/routes";
import { rideRouter } from "../packages/rides/src/routes";
import { matchingRouter } from "../packages/matching/src/routes";
import { promotionRouter } from "../packages/promotions/src/routes";
import { walletRouter } from "../packages/wallets/src/routes";
import { usersRouter } from "../packages/users/src/routes";

const app = express();
app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/rides", rideRouter);
app.use("/api/matching", matchingRouter);
app.use("/api/promotions", promotionRouter);
app.use("/api/wallets", walletRouter);
app.use("/api/users", usersRouter);

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
  const email = `qa6-${role}-${id}@qa.it`;
  await db.insert(users).values({ id, name: `QA6 ${role}`, email, passwordHash: "x", role });
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

const DROPOFF = { lat: -23.5505, lng: -46.6107 };

describeIfDb("QA audit: edge cases de validação", () => {
  const createdUserIds: string[] = [];
  const createdDriverIds: string[] = [];
  const createdVehicleIds: string[] = [];
  const createdCampaignIds: string[] = [];
  const createdCouponCodes: string[] = [];
  let passenger: TestActor;
  let admin: TestActor;
  let driver: { actor: TestActor; driverId: string; vehicleId: string };

  beforeAll(async () => {
    passenger = await makeActor("passenger");
    admin = await makeActor("admin");
    createdUserIds.push(passenger.id, admin.id);
    driver = await (async () => {
      const actor = await makeActor("driver");
      const vehicleId = randomUUID();
      await db.insert(vehicles).values({
        id: vehicleId,
        brand: "Test",
        model: "Model",
        year: 2024,
        plate: `QA6${vehicleId.slice(0, 6).toUpperCase()}`,
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
      createdUserIds.push(actor.id);
      createdDriverIds.push(driverId);
      createdVehicleIds.push(vehicleId);
      return { actor, driverId, vehicleId };
    })();
    await walletEngine.ensureWallet(passenger.id);
    await walletEngine.creditCents(passenger.id, 2_000_000);
  });

  afterAll(async () => {
    if (createdCouponCodes.length > 0) {
      const couponRows = await db
        .select({ id: coupons.id })
        .from(coupons)
        .where(inArray(coupons.code, createdCouponCodes));
      if (couponRows.length > 0) {
        await db
          .delete(promotion_redemptions)
          .where(inArray(promotion_redemptions.couponId, couponRows.map((c) => c.id)));
        await db.delete(coupons).where(inArray(coupons.code, createdCouponCodes));
      }
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

  test("[I-1] coordenada null/''/bool NÃO vira 0/1 (Ilha Nula)", async () => {
    // 1) corrida com pickup null/''
    const rideRes = await request(app)
      .post("/api/rides")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({
        pickupLocationLat: null,
        pickupLocationLng: "",
        dropoffLocationLat: DROPOFF.lat,
        dropoffLocationLng: DROPOFF.lng,
      });
    let pickupInfo = "não criada";
    if (rideRes.status === 201) {
      const rows = await db
        .select({ lat: rides.pickupLocationLat, lng: rides.pickupLocationLng })
        .from(rides)
        .where(eq(rides.id, rideRes.body.rideId));
      pickupInfo = `(${rows[0].lat}, ${rows[0].lng})`;
      // limpa a corrida inválida criada pelo RED para não travar o guard
      await request(app)
        .post(`/api/rides/${rideRes.body.rideId}/cancel`)
        .set("Authorization", `Bearer ${passenger.token}`)
        .send({ reason: "coords invalidas" });
    }
    console.log(`[I-1] rides lat=null/lng="" → ${rideRes.status} pickup=${pickupInfo}`);
    expect(rideRes.status).toBe(400); // RED: 201 em (0,0)

    // 2) motorista teleporta para (1,1) com true/true
    const locRes = await request(app)
      .post("/api/matching/driver/location")
      .set("Authorization", `Bearer ${driver.actor.token}`)
      .send({ lat: true, lng: true });
    let driverInfo = "n/a";
    if (locRes.status === 200) {
      const rows = await db
        .select({ lat: drivers.currentLocationLat, lng: drivers.currentLocationLng })
        .from(drivers)
        .where(eq(drivers.id, driver.driverId));
      driverInfo = `(${rows[0].lat}, ${rows[0].lng})`;
      // restaura posição real
      await db
        .update(drivers)
        .set({ currentLocationLat: "-23.5505", currentLocationLng: "-46.6333" })
        .where(eq(drivers.id, driver.driverId));
    }
    console.log(`[I-1] driver location true/true → ${locRes.status} coords=${driverInfo}`);
    expect(locRes.status).toBe(400); // RED: 200 e motorista em (1,1)

    // 3) nearby com lat vazio
    const nearRes = await request(app)
      .get(`/api/matching/drivers/nearby?lat=&lng=${DROPOFF.lng}`)
      .set("Authorization", `Bearer ${admin.token}`);
    console.log(`[I-1] nearby lat="" → ${nearRes.status}`);
    expect(nearRes.status).toBe(400); // RED: 200 (consulta (0,-46.6))
  });

  test("[I-2] campanha com datas null nasce com janela ABERTA (não 1970)", async () => {
    const camp = await request(app)
      .post("/api/promotions/campaign")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        name: "QA6 datas null",
        discountType: "percent",
        discountValue: 10,
        maxUses: 5,
        startDate: null,
        endDate: null,
      });
    expect(camp.status).toBe(201);
    createdCampaignIds.push(camp.body.campaignId as string);

    const rows = await db
      .select({ startDate: campaigns.start_date, endDate: campaigns.end_date })
      .from(campaigns)
      .where(eq(campaigns.id, camp.body.campaignId));
    console.log(
      `[I-2] endDate persistido=${rows[0].endDate ? new Date(rows[0].endDate).toISOString() : "null"}`
    );
    expect(rows[0].endDate).toBeFalsy(); // RED: 1970-01-01T00:00:00.000Z

    // cupom da campanha precisa funcionar de verdade
    const gen = await request(app)
      .post(`/api/promotions/campaign/${camp.body.campaignId}/coupon`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(gen.status).toBe(201);
    const code = gen.body.couponCode as string;
    createdCouponCodes.push(code);

    const rideRes = await request(app)
      .post("/api/rides")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({
        pickupLocationLat: -23.5505,
        pickupLocationLng: -46.6333,
        dropoffLocationLat: DROPOFF.lat,
        dropoffLocationLng: DROPOFF.lng,
      });
    expect(rideRes.status).toBe(201);
    const apply = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ rideId: rideRes.body.rideId, couponCode: code });
    console.log(`[I-2] apply com datas null → ${apply.status} ${JSON.stringify(apply.body.error ?? "ok")}`);
    expect(apply.status).toBe(200); // RED: 400 (janela encerrada em 1970)

    await request(app)
      .post(`/api/rides/${rideRes.body.rideId}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reason: "fim do I-2" });
  });

  test("[I-4] guardas de regressão: entradas malformadas continuam 400", async () => {
    const amountNull = await request(app)
      .post(`/api/wallets/${passenger.id}/contribute-reserve`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ amount: null });
    const amountAbc = await request(app)
      .post(`/api/wallets/${passenger.id}/contribute-reserve`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ amount: "abc" });
    const badPass = await request(app).post("/api/auth/register").send({
      name: "QA6 Pessoa",
      email: `qa6-reg-${randomUUID()}@qa.it`,
      password: "abcdefgh", // sem número
    });
    const strictProfile = await request(app)
      .put("/api/users/profile")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ phone: "11999999999", evil: 1 });
    const badWindow = await request(app)
      .post("/api/promotions/campaign")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        name: "QA6 janela invertida",
        discountType: "percent",
        discountValue: 10,
        startDate: "2026-12-31",
        endDate: "2026-01-01",
      });
    console.log(
      `[I-4] amount null=${amountNull.status} abc=${amountAbc.status} ` +
        `senha=${badPass.status} strict=${strictProfile.status} janela=${badWindow.status}`
    );
    expect(amountNull.status).toBe(400);
    expect(amountAbc.status).toBe(400);
    expect(badPass.status).toBe(400);
    expect(strictProfile.status).toBe(400);
    expect(badWindow.status).toBe(400);
  });
});
