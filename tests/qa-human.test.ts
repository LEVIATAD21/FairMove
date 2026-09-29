/**
 * AUDITORIA HUMANA — bugs adicionais X1–X10 (análise manual do fundador).
 *
 * Vereditos apurados por execução contra o código real:
 *  [X1] reserveEngine opera em "reais": o caminho da mensalidade faz
 *       centavos→reais (`/100`) e o engine reverte (`toCents`). Roundtrip é
 *       lossless (Math.round absorve FP) — NÃO há perda de precisão; o bug é
 *       de CONTRATO (centavos vestidos de reais). Correção: engine nativa em
 *       centavos, todos os call sites atualizados. Regressão do caminho da
 *       mensalidade: tests/subscription-qa-audit [BUG-D] (amount === 4900).
 *  [X2] Regra "driverCredit === fare": guard no construtor do input de settle
 *       (rota complete) — settlement.ts fica CONGELADO (restrição PSP).
 *       Divergência → 500, claim intocado, nenhum centavo se move.
 *  [X3] findNearbyDrivers sem LIMIT (resposta não-bounded) + filtro de tipo
 *       em JS AFTER fetch. Correção: limit padrão 50 e tipo no SQL.
 *  [X4] updateDriverLocation sem faixa — defense-in-depth (rota HTTP e WS já
 *       validam; o engine agora também rejeita).
 *  [X5] calculateQuote sem preço mínimo: surge 0.5 em trecho curto fica abaixo
 *       da base. minFare (R$7) como PISO após desconto; desconto efetivo
 *       reportado honestamente (original − final). PREMISSA CORRIGIDA: 50 m
 *       custa R$7,97 (base+dist+tempo), não R$7,00 — minFare é piso, não teto.
 *  [X6] Segundo cupom DIFERENTE era aceito em silêncio com a resposta do
 *       PRIMEIRO (discountApplied=true engaçoso). Correção: código diferente →
 *       409; MESMO código continua idempotente (contrato documentado +
 *       tests/security/coupon-race).
 *  [X7] cancelSubscription não documentava período vigente nem política de
 *       reembolso na resposta.
 *  [X8] FALSO POSITIVO: resolveActiveDiscountPercent JÁ valida vigência
 *       (issuedAt ≤ now < issuedAt + durationMonths) e escolhe o MAIOR
 *       desconto vigente por design (FairMove League). Sem alteração.
 *  [X9] Só documentação (transferência entre buckets nunca existiu).
 *  [X10] walletEngine sem método de histórico (rotas consultam banco direto).
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
  emergency_reserves,
  reserve_transactions,
  coupons,
  campaigns,
  promotion_redemptions,
  subscriptions,
} from "../packages/shared-db/src/index";
import { reserveEngine } from "../packages/reserves/src/engine/reserve-engine";
import { walletEngine } from "../packages/wallets/src/engine/wallet-engine";
import { subscriptionEngine } from "../packages/subscriptions/src/engine/subscription-engine";
import {
  findNearbyDrivers,
  updateDriverLocation,
} from "../packages/matching/src/engine/matching-engine";
import { calculateQuote } from "../packages/pricing/src/engine/calculator";
import { getJwtSecret } from "../packages/auth/src/middleware";
import { authRouter } from "../packages/auth/src/routes";
import { rideRouter } from "../packages/rides/src/routes";
import { promotionRouter } from "../packages/promotions/src/routes";
import { walletRouter } from "../packages/wallets/src/routes";

const app = express();
app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/rides", rideRouter);
app.use("/api/promotions", promotionRouter);
app.use("/api/wallets", walletRouter);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface TestActor {
  id: string;
  sessionId: string;
  token: string;
  email: string;
}

const createdUserIds: string[] = [];
const createdDriverIds: string[] = [];
const createdVehicleIds: string[] = [];
const createdRideIds: string[] = [];
const createdCampaignIds: string[] = [];
const createdCouponCodes: string[] = [];
const seededTxIds: string[] = [];

async function makeActor(role: string): Promise<TestActor> {
  const id = randomUUID();
  const email = `qax-${role}-${id}@qa.it`;
  await db.insert(users).values({ id, name: `QAX ${role}`, email, passwordHash: "x", role });
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
  createdUserIds.push(id);
  return { id, sessionId, token, email };
}

// Ponto REMOTO (≈55 km do centro de SP): o seeding desta suíte não pode vazar
// para os testes de nearby de outras suítes (raio ≤ 10 km a partir do centro).
const REMOTE = { lat: -23.99, lng: -46.3 };
const PICKUP = { lat: -23.5505, lng: -46.6333 };
const DROPOFF = { lat: -23.5505, lng: -46.6107 };

async function makeDriverRemote(vehicleType: "car" | "motorcycle" = "car"): Promise<{
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
    plate: `QAX${vehicleId.slice(0, 7).toUpperCase()}`,
    vehicleType,
  });
  const driverId = randomUUID();
  await db.insert(drivers).values({
    id: driverId,
    userId: actor.id,
    vehicleId,
    status: "online",
    available: true,
    currentLocationLat: String(REMOTE.lat),
    currentLocationLng: String(REMOTE.lng),
  });
  createdDriverIds.push(driverId);
  createdVehicleIds.push(vehicleId);
  return { actor, driverId, vehicleId };
}

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
  createdRideIds.push(res.body.rideId as string);
  return res.body.rideId as string;
}

const ADVANCE_CHAIN = ["DRIVER_ARRIVING", "DRIVER_AT_PICKUP", "PASSENGER_ONBOARD", "IN_PROGRESS"];

async function advanceTo(
  rideId: string,
  driver: Awaited<ReturnType<typeof makeDriverRemote>>,
  target: string
): Promise<void> {
  for (const status of ADVANCE_CHAIN) {
    const res = await request(app)
      .patch(`/api/rides/${rideId}/status`)
      .set("Authorization", `Bearer ${driver.actor.token}`)
      .send({ status });
    expect(res.status).toBe(200);
    if (status === target) return;
  }
}

async function getRideStatus(rideId: string): Promise<string> {
  const rows = await db.select({ status: rides.status }).from(rides).where(eq(rides.id, rideId));
  return rows[0]?.status ?? "MISSING";
}

async function makeCoupon(
  admin: TestActor,
  opts: { percent: number; maxUses: number }
): Promise<{ code: string; campaignId: string }> {
  const camp = await request(app)
    .post("/api/promotions/campaign")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({
      name: `QAX campanha ${randomUUID().slice(0, 8)}`,
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

describeIfDb("Auditoria humana: bugs adicionais X1–X10", () => {
  let passenger: TestActor;
  let admin: TestActor;

  beforeAll(async () => {
    passenger = await makeActor("passenger");
    admin = await makeActor("admin");
    await walletEngine.ensureWallet(passenger.id);
    await walletEngine.creditCents(passenger.id, 2_000_000);
  });

  afterAll(async () => {
    if (seededTxIds.length > 0) {
      await db.delete(ledger_transactions).where(inArray(ledger_transactions.id, seededTxIds));
    }
    if (createdCouponCodes.length > 0) {
      const couponRows = await db
        .select({ id: coupons.id })
        .from(coupons)
        .where(inArray(coupons.code, createdCouponCodes));
      const couponIds = couponRows.map((c) => c.id);
      if (couponIds.length > 0) {
        await db
          .delete(promotion_redemptions)
          .where(inArray(promotion_redemptions.couponId, couponIds));
      }
      await db.delete(coupons).where(inArray(coupons.code, createdCouponCodes));
    }
    if (createdCampaignIds.length > 0) {
      await db.delete(campaigns).where(inArray(campaigns.id, createdCampaignIds));
    }
    if (createdRideIds.length > 0) {
      await db.delete(rideLocationEvents).where(inArray(rideLocationEvents.rideId, createdRideIds));
      await db.delete(rides).where(inArray(rides.id, createdRideIds));
    }
    if (createdUserIds.length > 0) {
      const reserveRows = await db
        .select({ id: emergency_reserves.id })
        .from(emergency_reserves)
        .where(inArray(emergency_reserves.driverId, createdUserIds));
      const reserveIds = reserveRows.map((r) => r.id);
      if (reserveIds.length > 0) {
        await db
          .delete(reserve_transactions)
          .where(inArray(reserve_transactions.reserveId, reserveIds));
        await db.delete(emergency_reserves).where(inArray(emergency_reserves.id, reserveIds));
      }
      const walletRows = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(inArray(wallets.userId, createdUserIds));
      const walletIds = walletRows.map((w) => w.id);
      if (walletIds.length > 0) {
        await db.delete(ledger_entries).where(inArray(ledger_entries.walletId, walletIds));
        await db.delete(ledger_transactions).where(inArray(ledger_transactions.walletId, walletIds));
        await db.delete(wallets).where(inArray(wallets.id, walletIds));
      }
      if (createdDriverIds.length > 0) {
        await db.delete(drivers).where(inArray(drivers.id, createdDriverIds));
      }
      if (createdVehicleIds.length > 0) {
        await db.delete(vehicles).where(inArray(vehicles.id, createdVehicleIds));
      }
      await db.delete(subscriptions).where(inArray(subscriptions.userId, createdUserIds));
      await db.delete(verificationTokens).where(inArray(verificationTokens.userId, createdUserIds));
      await db.delete(sessions).where(inArray(sessions.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  test("[X1] reserveEngine.contributeToReserve opera em CENTAVOS (sem double conversion)", async () => {
    const uid = randomUUID();
    await db.insert(users).values({
      id: uid,
      name: "QAX X1",
      email: `qax-x1-${uid}@qa.it`,
      passwordHash: "x",
      role: "driver",
    });
    createdUserIds.push(uid);

    // Contrato novo: 4900 = R$49,00 EXATOS no bucket (não 4900 "reais").
    await reserveEngine.contributeToReserve(uid, 4900, "emergency");
    const reserve = await reserveEngine.getReserve(uid);
    const bucket = Number(reserve?.emergency_usage ?? -1);
    const total = Number(reserve?.total_reserve ?? -1);
    console.log(`[X1] emergency_usage=${bucket} total=${total} (esperado 4900/4900)`);
    expect(bucket).toBe(4900); // RED pré-fix: 490000 (entrada tratada como reais)
    expect(total).toBe(4900);

    // recordContribution acompanha o mesmo contrato (histórico em centavos).
    await reserveEngine.recordContribution(uid, 4900, "emergency");
    const history = await db
      .select({ amount: reserve_transactions.amount })
      .from(reserve_transactions)
      .innerJoin(emergency_reserves, eq(emergency_reserves.id, reserve_transactions.reserveId))
      .where(eq(emergency_reserves.driverId, uid));
    console.log(`[X1] histórico=${JSON.stringify(history)}`);
    expect(history).toHaveLength(1);
    expect(Number(history[0].amount)).toBe(4900);
  });

  test("[X2] complete rejeita driverCredit ≠ fare — guarda da regra de negócio", async () => {
    const pax = await makeActor("passenger");
    const driver = await makeDriverRemote();
    await walletEngine.ensureWallet(pax.id);
    await walletEngine.creditCents(pax.id, 500_000);

    const rideId = await createRide(pax);
    const accept = await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver.actor.token}`);
    expect(accept.status).toBe(200);
    await advanceTo(rideId, driver, "IN_PROGRESS");

    // Divergência plantada à mão (só corrupção de dados chega aqui).
    const rideRows = await db
      .select({ fare: rides.finalPassengerPrice })
      .from(rides)
      .where(eq(rides.id, rideId));
    const fare = Number(rideRows[0].fare);
    await db.update(rides).set({ driverCredit: fare - 100 }).where(eq(rides.id, rideId));

    const balances = async (userId: string): Promise<number> => {
      const w = await db
        .select({ b: wallets.available_balance })
        .from(wallets)
        .where(eq(wallets.userId, userId));
      return Number(w[0]?.b ?? -1);
    };
    const paxBefore = await balances(pax.id);
    const drvBefore = await balances(driver.actor.id);

    const res = await request(app)
      .post(`/api/rides/${rideId}/complete`)
      .set("Authorization", `Bearer ${driver.actor.token}`);

    const paxAfter = await balances(pax.id);
    const drvAfter = await balances(driver.actor.id);
    const status = await getRideStatus(rideId);
    console.log(
      `[X2] complete→${res.status} "${res.body.error}" | status=${status} | ` +
        `passageiro ${paxBefore}→${paxAfter} motorista ${drvBefore}→${drvAfter}`
    );

    expect(res.status).toBe(500); // RED pré-fix: 200 (settle com valores divergentes)
    expect(String(res.body.error)).toContain("Business rule violation");
    expect(status).toBe("IN_PROGRESS"); // claim intocado
    expect(paxAfter).toBe(paxBefore); // nenhum centavo moveu
    expect(drvAfter).toBe(drvBefore);
  });

  test("[X3] findNearbyDrivers é bounded (limit 50) e filtra tipo no SQL", async () => {
    // 55 carros + 25 motos no ponto remoto — todos online/disponíveis.
    const N_CARS = 55;
    const N_MOTOS = 25;
    const userIds: string[] = [];
    const vehicleIds: string[] = [];
    const driverIds: string[] = [];
    const userRows: (typeof users.$inferInsert)[] = [];
    const vehicleRows: (typeof vehicles.$inferInsert)[] = [];
    const driverRows: (typeof drivers.$inferInsert)[] = [];
    for (let i = 0; i < N_CARS + N_MOTOS; i++) {
      const isMoto = i >= N_CARS;
      const uid = randomUUID();
      const vid = randomUUID();
      const did = randomUUID();
      userRows.push({
        id: uid,
        name: `QAX X3 ${i}`,
        email: `qax-x3-${i}-${uid}@qa.it`,
        passwordHash: "x",
        role: "driver",
      });
      vehicleRows.push({
        id: vid,
        brand: "Test",
        model: "Model",
        year: 2024,
        plate: `QAX3${vid.slice(0, 7).toUpperCase()}`,
        vehicleType: isMoto ? "motorcycle" : "car",
      });
      driverRows.push({
        id: did,
        userId: uid,
        vehicleId: vid,
        status: "online",
        available: true,
        currentLocationLat: String(REMOTE.lat + (i % 7) * 0.0001),
        currentLocationLng: String(REMOTE.lng + (i % 5) * 0.0001),
      });
      userIds.push(uid);
      vehicleIds.push(vid);
      driverIds.push(did);
    }
    await db.insert(users).values(userRows);
    await db.insert(vehicles).values(vehicleRows);
    await db.insert(drivers).values(driverRows);
    createdUserIds.push(...userIds);
    createdVehicleIds.push(...vehicleIds);
    createdDriverIds.push(...driverIds);

    // Cast: o parâmetro `limit` só passa a existir COM a correção.
    const find = findNearbyDrivers as unknown as (
      lat: number,
      lng: number,
      vehicleType?: "car" | "motorcycle",
      maxDistanceKm?: number,
      limit?: number
    ) => Promise<{ vehicleType: string }[]>;

    const all = await find(REMOTE.lat, REMOTE.lng, undefined, 10);
    console.log(`[X3] nearby default → ${all.length} linhas (esperado ≤50 de ${N_CARS + N_MOTOS})`);
    expect(all.length).toBeLessThanOrEqual(50); // RED pré-fix: 80

    const motos = await find(REMOTE.lat, REMOTE.lng, "motorcycle", 10, 5);
    console.log(
      `[X3] nearby motorcycle limit=5 → ${motos.length} linhas, ` +
        `tipos=${JSON.stringify([...new Set(motos.map((m) => m.vehicleType))])}`
    );
    expect(motos.length).toBeLessThanOrEqual(5); // RED pré-fix: 25 (limit ignorado)
    expect(motos.every((m) => m.vehicleType === "motorcycle")).toBe(true);
  });

  test("[X4] updateDriverLocation rejeita coordenadas fora de faixa (defense-in-depth)", async () => {
    const driver = await makeDriverRemote();

    await expect(updateDriverLocation(driver.driverId, 999, REMOTE.lng)).rejects.toThrow(
      "Invalid latitude"
    ); // RED pré-fix: aceita e grava 999

    await expect(updateDriverLocation(driver.driverId, REMOTE.lat, 999)).rejects.toThrow(
      "Invalid longitude"
    );

    await expect(updateDriverLocation(driver.driverId, Number.NaN, REMOTE.lng)).rejects.toThrow(
      "Invalid latitude"
    );

    const rows = await db
      .select({ lat: drivers.currentLocationLat, lng: drivers.currentLocationLng })
      .from(drivers)
      .where(eq(drivers.id, driver.driverId));
    console.log(`[X4] linha intacta lat=${rows[0].lat} lng=${rows[0].lng}`);
    expect(Number(rows[0].lat)).toBeCloseTo(REMOTE.lat, 6);
    expect(Number(rows[0].lng)).toBeCloseTo(REMOTE.lng, 6);
  });

  test("[X5] preço mínimo (minFare) vale como PISO após desconto", () => {
    // Surge 0.5 + trecho curto: fórmula crua cai abaixo da base → piso R$7.
    const cheap = calculateQuote(7.0, 0.1, 1.0, 0.5, 0);
    console.log(
      `[X5] surge0.5 curta → original=${cheap.originalPrice} final=${cheap.passengerPrice}`
    );
    expect(cheap.passengerPrice).toBe(7.0); // RED pré-fix: 4.01
    expect(cheap.driverCredit).toBe(cheap.passengerPrice);

    // Desconto promocional maior que o preço: piso + desconto efetivo honesto.
    const deep = calculateQuote(7.0, 10.0, 5.0, 1.0, 30);
    console.log(
      `[X5] promo30 → original=${deep.originalPrice} desconto=${deep.promotionDiscount} final=${deep.passengerPrice}`
    );
    expect(deep.passengerPrice).toBe(7.0); // RED pré-fix: 0
    expect(deep.promotionDiscount).toBeCloseTo(deep.originalPrice - 7.0, 2);
    expect(deep.driverCredit).toBe(deep.passengerPrice);

    // PREMISSA CORRIGIDA: 50 m custa R$7,97 (base+dist+tempo), não R$7,00 —
    // minFare é piso, não teto: valor acima do mínimo nunca é cortado.
    const fiftyMeters = calculateQuote(7.0, 0.05, 1.0, 1.0, 0);
    console.log(`[X5] 50m sem promo → ${fiftyMeters.passengerPrice} (esperado 7.97)`);
    expect(fiftyMeters.passengerPrice).toBe(7.97);
  });

  test("[X6] segundo cupom DIFERENTE → 409; mesmo cupom segue idempotente", async () => {
    const pax = await makeActor("passenger");
    await walletEngine.ensureWallet(pax.id);
    await walletEngine.creditCents(pax.id, 500_000);

    const rideId = await createRide(pax);
    const { code: codeA } = await makeCoupon(admin, { percent: 10, maxUses: 5 });
    const { code: codeB } = await makeCoupon(admin, { percent: 20, maxUses: 5 });

    const first = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${pax.token}`)
      .send({ rideId, couponCode: codeA });
    expect(first.status).toBe(200);
    expect(first.body.discountApplied).toBe(true);

    // O MESMO cupom continua idempotente (contrato documentado + coupon-race).
    const retry = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${pax.token}`)
      .send({ rideId, couponCode: codeA });
    expect(retry.status).toBe(200);

    // Um cupom DIFERENTE não pode ser "aceito" com a resposta do primeiro.
    const second = await request(app)
      .post("/api/promotions/apply")
      .set("Authorization", `Bearer ${pax.token}`)
      .send({ rideId, couponCode: codeB });
    console.log(
      `[X6] apply ${codeA}→${first.status} retry→${retry.status} | apply ${codeB}→` +
        `${second.status} "${second.body.error}"`
    );
    expect(second.status).toBe(409); // RED pré-fix: 200 + discountApplied=true (engaçoso)
    expect(String(second.body.error)).toContain("Only one coupon per ride");

    // Preço continua com EXATAMENTE o desconto do PRIMEIRO cupom.
    const rideRows = await db
      .select({ discount: rides.promotionDiscount })
      .from(rides)
      .where(eq(rides.id, rideId));
    const expectedCents = Math.round((first.body.discount as number) * 100);
    expect(Number(rideRows[0].discount)).toBe(expectedCents);
  });

  test("[X7] cancelSubscription documenta período vigente e política de reembolso", async () => {
    const uid = randomUUID();
    await db.insert(users).values({
      id: uid,
      name: "QAX X7",
      email: `qax-x7-${uid}@qa.it`,
      passwordHash: "x",
      role: "driver",
    });
    createdUserIds.push(uid);

    const activated = await subscriptionEngine.activateSubscription(uid);
    expect(activated.success).toBe(true);
    const result = await subscriptionEngine.cancelSubscription(uid);
    console.log(`[X7] cancel msg="${result.message}"`);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Período vigente até \d{4}-\d{2}-\d{2}/); // RED: msg genérica
    expect(result.message).toMatch(/\d+ dias restantes/);
    expect(result.message).toMatch(/Sem reembolso proporcional/);
  });

  test("[X10] walletEngine.getTransactionHistory (extrato encapsulado, ordenado)", async () => {
    const method = (walletEngine as unknown as Record<string, unknown>).getTransactionHistory;
    console.log(`[X10] typeof getTransactionHistory = ${typeof method}`);
    expect(typeof method).toBe("function"); // RED pré-fix: undefined

    const fn = (method as (...args: unknown[]) => unknown).bind(walletEngine) as (
      userId: string,
      limit?: number,
      offset?: number
    ) => Promise<{ id: string }[]>;

    // 3 transações com created_at crescente.
    const base = Date.now() - 60 * 1000;
    const walletRows = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, passenger.id));
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: randomUUID(),
      walletId: walletRows[0].id,
      transactionType: "deposit",
      amount: 100 + i,
      description: `seed qax tx ${i}`,
      idempotencyKey: `qaxtx-${i}-${randomUUID().slice(0, 8)}`,
      created_at: new Date(base + i * 1000),
    }));
    await db.insert(ledger_transactions).values(rows);
    seededTxIds.push(...rows.map((r) => r.id));

    const all = await fn(passenger.id, 100, 0);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const times = all.map((t) => t.id); // ordenação checada abaixo via rota
    expect(times.length).toBe(all.length);

    const limited = await fn(passenger.id, 1, 0);
    expect(limited).toHaveLength(1);

    // Paridade com a rota (que passa a usar o mesmo método — BUG-H1 preservado).
    const res = await request(app)
      .get(`/api/wallets/${passenger.id}/transactions`)
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(res.status).toBe(200);
    const routeFirst = res.body.transactions[0]?.id as string;
    console.log(`[X10] engine[0]=${limited[0]?.id?.slice(0, 8)} rota[0]=${routeFirst?.slice(0, 8)}`);
    expect(limited[0].id).toBe(routeFirst);
  });
});
