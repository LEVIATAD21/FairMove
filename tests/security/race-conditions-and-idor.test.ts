/**
 * Segurança das rotas HTTP (teste de regressão das correções):
 * - payments: exige JWT + role admin (antes: aberto ao mundo);
 * - rides: passageiro só com UMA corrida ativa (corridas fantasmas);
 * - accept: um motorista só consegue UMA corrida (claim atômico anti-TOCTOU)
 *   e dois motoristas não dividem a mesma corrida;
 * - forgot-password: o token de reset nunca aparece em log;
 * - refresh: sessions guarda SHA-256 (nunca o token em claro) + migração.
 *
 * Sobe um Express real com os routers e chama requireAuth de verdade
 * (JWT assinado + linha de sessão no banco). Requer DATABASE_URL.
 */
import "dotenv/config";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

import express from "express";
import request from "supertest";
import { createHash, createHmac, randomBytes, randomUUID } from "crypto";
import { sign } from "jsonwebtoken";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  walletDeposits,
} from "../../packages/shared-db/src/index";
import { walletEngine } from "../../packages/wallets/src/engine/wallet-engine";
import { createPixDeposit, processMercadoPagoPaymentWebhook, verifyMercadoPagoWebhookSignature } from "../../packages/payments/src/mercado-pago";
import {
  getJwtSecret,
  getRefreshTokenSecret,
} from "../../packages/auth/src/middleware";
import { authRouter } from "../../packages/auth/src/routes";
import { paymentRouter } from "../../packages/payments/src/routes";
import { rideRouter } from "../../packages/rides/src/routes";

const app = express();
app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/rides", rideRouter);

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
  const email = `${role}-${id}@sec.it`;
  await db.insert(users).values({
    id,
    name: `Sec ${role}`,
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

async function makeDriverOnline(vehicleType: "car" | "motorcycle" = "car"): Promise<{
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
    plate: `SEC${vehicleId.slice(0, 6).toUpperCase()}`,
    vehicleType,
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
  expect(res.status).toBe(201);
  return res.body.rideId as string;
}

describeIfDb("security: HTTP routes", () => {
  const createdUserIds: string[] = [];
  const createdDriverIds: string[] = [];
  const createdVehicleIds: string[] = [];

  async function actor(role: string): Promise<TestActor> {
    const a = await makeActor(role);
    createdUserIds.push(a.id);
    return a;
  }

  afterAll(async () => {
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
      await db.delete(walletDeposits).where(inArray(walletDeposits.userId, createdUserIds));
      // Ledger e wallets criados pelos testes financeiros (FKs antes de users).
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

  describe("payments exige autenticação e role admin", () => {
    it("sem token → 401", async () => {
      const res = await request(app).post("/api/payments/authorize").send({
        amount: 1000,
        currency: "BRL",
        driverId: "any",
      });
      expect(res.status).toBe(401);
    });

    it("passenger autenticado → 403 (não é admin)", async () => {
      const passenger = await actor("passenger");
      const res = await request(app)
        .post("/api/payments/authorize")
        .set("Authorization", `Bearer ${passenger.token}`)
        .send({ amount: 1000, currency: "BRL", driverId: "any" });
      expect(res.status).toBe(403);
    });

    it("admin → 200 (fluxo legítimo preservado)", async () => {
      const admin = await actor("admin");
      const res = await request(app)
        .post("/api/payments/authorize")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ amount: 1000, currency: "BRL", driverId: "drv-1" });
      expect(res.status).toBe(200);
      expect(res.body.transactionId).toBeTruthy();
    });

    it("body inválido → 400 (Zod)", async () => {
      const admin = await actor("admin");
      const res = await request(app)
        .post("/api/payments/authorize")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ amount: -5 });
      expect(res.status).toBe(400);
    });
  });

  describe("corridas fantasmas bloqueadas", () => {
    it("segunda corrida de passageiro com corrida ativa → 409", async () => {
      const passenger = await actor("passenger");
      const first = await createRide(passenger);
      expect(first).toBeTruthy();

      const res = await request(app)
        .post("/api/rides")
        .set("Authorization", `Bearer ${passenger.token}`)
        .send({
          pickupLocationLat: PICKUP.lat,
          pickupLocationLng: PICKUP.lng,
          dropoffLocationLat: DROPOFF.lat,
          dropoffLocationLng: DROPOFF.lng,
        });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/active ride/i);
    });
  });

  describe("accept: claim atômico do motorista (anti-TOCTOU)", () => {
    it("mesmo driver aceitando 2 corridas em paralelo → exatamente 1 sucesso", async () => {
      const passengerA = await actor("passenger");
      const passengerB = await actor("passenger");
      const rideA = await createRide(passengerA);
      const rideB = await createRide(passengerB);
      const driver = await makeDriverOnline();
      createdUserIds.push(driver.actor.id);
      createdDriverIds.push(driver.driverId);
      createdVehicleIds.push(driver.vehicleId);

      const [resA, resB] = await Promise.all([
        request(app)
          .post(`/api/rides/${rideA}/accept`)
          .set("Authorization", `Bearer ${driver.actor.token}`),
        request(app)
          .post(`/api/rides/${rideB}/accept`)
          .set("Authorization", `Bearer ${driver.actor.token}`),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(1);

      // O motorista ficou indisponível e tem exatamente UMA corrida atribuída.
      const driverRow = await db
        .select({ available: drivers.available })
        .from(drivers)
        .where(eq(drivers.id, driver.driverId));
      expect(driverRow[0].available).toBe(false);

      const assigned = await db
        .select({ id: rides.id })
        .from(rides)
        .where(eq(rides.driverId, driver.driverId));
      expect(assigned).toHaveLength(1);
    });

    it("dois drivers na MESMA corrida em paralelo → só um atribui", async () => {
      const passenger = await actor("passenger");
      const rideId = await createRide(passenger);
      const d1 = await makeDriverOnline();
      const d2 = await makeDriverOnline("motorcycle");
      createdUserIds.push(d1.actor.id, d2.actor.id);
      createdDriverIds.push(d1.driverId, d2.driverId);
      createdVehicleIds.push(d1.vehicleId, d2.vehicleId);

      const [r1, r2] = await Promise.all([
        request(app)
          .post(`/api/rides/${rideId}/accept`)
          .set("Authorization", `Bearer ${d1.actor.token}`),
        request(app)
          .post(`/api/rides/${rideId}/accept`)
          .set("Authorization", `Bearer ${d2.actor.token}`),
      ]);

      const statuses = [r1.status, r2.status].sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(1);

      const rideRows = await db
        .select({ driverId: rides.driverId, status: rides.status })
        .from(rides)
        .where(eq(rides.id, rideId));
      expect(rideRows[0].status).toBe("DRIVER_ASSIGNED");
      expect(rideRows[0].driverId).not.toBeNull();
    });
  });

  describe("complete: settlement idempotente sob corrida (regressão do bug TOCTOU)", () => {
    it("completar a mesma corrida em paralelo: settle exatamente1×, zero500, saldos exatos", async () => {
      const passenger = await actor("passenger");
      const rideId = await createRide(passenger);
      const driver = await makeDriverOnline();
      createdUserIds.push(driver.actor.id);
      createdDriverIds.push(driver.driverId);
      createdVehicleIds.push(driver.vehicleId);

      // Saldo real para a liquidação sair pela carteira (não pelo gateway).
      await walletEngine.ensureWallet(passenger.id);
      await walletEngine.creditCents(passenger.id, 10_000);

      const accept = await request(app)
        .post(`/api/rides/${rideId}/accept`)
        .set("Authorization", `Bearer ${driver.actor.token}`);
      expect(accept.status).toBe(200);

      for (const status of [
        "DRIVER_ARRIVING",
        "DRIVER_AT_PICKUP",
        "PASSENGER_ONBOARD",
        "IN_PROGRESS",
      ]) {
        const step = await request(app)
          .patch(`/api/rides/${rideId}/status`)
          .set("Authorization", `Bearer ${driver.actor.token}`)
          .send({ status });
        expect(step.status).toBe(200);
      }

      const passengerBefore = await walletEngine.getAvailableBalance(passenger.id);
      const driverBefore = await walletEngine.getAvailableBalance(driver.actor.id);
      const rideRow = await db.select().from(rides).where(eq(rides.id, rideId));
      const fareCents = Number(rideRow[0].finalPassengerPrice);
      const driverCreditCents = Number(rideRow[0].driverCredit);
      expect(fareCents).toBeGreaterThan(0);

      // Corrida:4 completions simultâneos (o bug original devia500 no perdedor).
      const completions = await Promise.all(
        Array.from({ length: 4 }, () =>
          request(app)
            .post(`/api/rides/${rideId}/complete`)
            .set("Authorization", `Bearer ${driver.actor.token}`)
        )
      );

      const statuses = completions.map((r) => r.status);
      expect(statuses).not.toContain(500);
      // Todo perdedor cai em409 (claim) ou400 (já COMPLETED); vencedor200.
      expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
      expect(
        completions
          .filter((r) => r.status !== 200)
          .every((r) => [400, 409].includes(r.status))
      ).toBe(true);

      // Dinheiro: exatamente UM settle (variação de saldo igual ao fare1×).
      const passengerAfter = await walletEngine.getAvailableBalance(passenger.id);
      const driverAfter = await walletEngine.getAvailableBalance(driver.actor.id);
      expect(passengerBefore - passengerAfter).toBe(fareCents);
      expect(driverAfter - driverBefore).toBe(driverCreditCents);

      // Ledger: exatamente1 débito do passageiro e1 crédito do driver.
      const passengerWallet = await walletEngine.getWallet(passenger.id);
      const driverWallet = await walletEngine.getWallet(driver.actor.id);
      const debitRows = await db
        .select({ id: ledger_transactions.id })
        .from(ledger_transactions)
        .where(
          and(
            eq(ledger_transactions.walletId, passengerWallet!.id),
            sql`ledger_transactions.idempotency_key = ${`ride:${rideId}:passenger-debit`}`
          )
        );
      const creditRows = await db
        .select({ id: ledger_transactions.id })
        .from(ledger_transactions)
        .where(
          and(
            eq(ledger_transactions.walletId, driverWallet!.id),
            sql`ledger_transactions.idempotency_key = ${`ride:${rideId}:driver-credit`}`
          )
        );
      expect(debitRows).toHaveLength(1);
      expect(creditRows).toHaveLength(1);

      const finalRide = await db.select().from(rides).where(eq(rides.id, rideId));
      expect(finalRide[0].status).toBe("COMPLETED");
    });
  });

  describe("reset token nunca vaza para log", () => {
    it("forgot-password: log redigido, corpo sem token, banco guarda só hash", async () => {
      const user = await actor("passenger");
      const infoSpy = jest.spyOn(console, "info").mockImplementation(() => undefined);

      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: user.email });

      expect(res.status).toBe(200);
      // Resposta padrão (sem EXPOSE_RESET_TOKEN) não traz o token.
      expect(res.body.resetToken).toBeUndefined();

      const logged = infoSpy.mock.calls
        .map((call) => call.map(String).join(" "))
        .join("\n");
      infoSpy.mockRestore();

      // Nenhum hex de64 chars (formato do token cru) aparece no log.
      const hex64 = /[a-f0-9]{64}/i;
      expect(logged).not.toMatch(hex64);
      expect(logged).toContain("token redacted");

      // No banco: apenas o SHA-256 do token (64 hex), nunca o JWT/hex cru.
      const rows = await db
        .select({ token: verificationTokens.token })
        .from(verificationTokens)
        .where(eq(verificationTokens.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].token).toMatch(/^[a-f0-9]{64}$/);
    });

    it("reset-password token is single-use under concurrent requests", async () => {
      const user = await actor("passenger");
      const rawToken = randomBytes(32).toString("hex");
      await db.insert(verificationTokens).values({
        id: randomUUID(),
        userId: user.id,
        token: sha256(rawToken),
        expiresAt: new Date(Date.now() + 60 * 1000),
      });

      const [first, second] = await Promise.all([
        request(app).post("/api/auth/reset-password").send({
          token: rawToken.toUpperCase(),
          password: "StrongerPass123",
        }),
        request(app).post("/api/auth/reset-password").send({
          token: rawToken,
          password: "OtherSecurePass456",
        }),
      ]);

      expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 400]);

      const storedUsers = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id));
      expect(storedUsers).toHaveLength(1);
      expect(storedUsers[0].passwordHash).not.toBe("x");

      const remainingTokens = await db
        .select({ id: verificationTokens.id })
        .from(verificationTokens)
        .where(eq(verificationTokens.userId, user.id));
      expect(remainingTokens).toHaveLength(0);

      const remainingSessions = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, user.id));
      expect(remainingSessions).toHaveLength(0);
    });
  });

  describe("refresh token: sessions guarda hash (nunca em claro)", () => {
    it("refresh válido rotaciona e grava SHA-256 da sessão", async () => {
      const user = await actor("passenger");
      const sessionId = randomUUID();
      const refreshToken = sign(
        { userId: user.id, role: "passenger", sessionId, type: "refresh" },
        getRefreshTokenSecret(),
        { expiresIn: "7d", algorithm: "HS256" }
      );
      await db.insert(sessions).values({
        id: sessionId,
        userId: user.id,
        role: "passenger",
        token: sha256(refreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const res = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.refreshToken).toBeTruthy();

      const rows = await db
        .select({ token: sessions.token })
        .from(sessions)
        .where(eq(sessions.id, sessionId));
      // Nunca o JWT em claro: SHA-256 (64 hex) e diferente do apresentado.
      expect(rows[0].token).toMatch(/^[a-f0-9]{64}$/);
      expect(rows[0].token).not.toBe(res.body.refreshToken);
      expect(rows[0].token).toBe(sha256(res.body.refreshToken));
    });

    it("sessão legada com token em claro é migrada para hash no primeiro refresh", async () => {
      const user = await actor("passenger");
      const sessionId = randomUUID();
      const refreshToken = sign(
        { userId: user.id, role: "passenger", sessionId, type: "refresh" },
        getRefreshTokenSecret(),
        { expiresIn: "7d", algorithm: "HS256" }
      );
      // Estado legado: token gravado em texto puro.
      await db.insert(sessions).values({
        id: sessionId,
        userId: user.id,
        role: "passenger",
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const res = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken });

      expect(res.status).toBe(200);

      const rows = await db
        .select({ token: sessions.token })
        .from(sessions)
        .where(eq(sessions.id, sessionId));
      // Migração: o token cru nunca fica armazenado; após a rotação o banco
      // guarda o SHA-256 do refresh NOVO emitido.
      expect(rows[0].token).not.toBe(refreshToken);
      expect(rows[0].token).toBe(sha256(res.body.refreshToken));
    });

    it("reuse de refresh token antigo revoga a sessão", async () => {
      const user = await actor("passenger");
      const sessionId = randomUUID();
      const oldToken = sign(
        { userId: user.id, role: "passenger", sessionId, type: "refresh", jti: randomUUID() },
        getRefreshTokenSecret(),
        { expiresIn: "7d", algorithm: "HS256" }
      );
      const currentToken = sign(
        { userId: user.id, role: "passenger", sessionId, type: "refresh", jti: randomUUID() },
        getRefreshTokenSecret(),
        { expiresIn: "7d", algorithm: "HS256" }
      );
      expect(oldToken).not.toBe(currentToken);
      await db.insert(sessions).values({
        id: sessionId,
        userId: user.id,
        role: "passenger",
        token: sha256(currentToken), // sessão aponta para o token vigente
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const res = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: oldToken });

      expect(res.status).toBe(401);
      const rows = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, sessionId));
      expect(rows).toHaveLength(0); // revogada
    });
  });

  describe("Mercado Pago Pix: assinatura e liquidação idempotente", () => {
    it("valida a assinatura HMAC e rejeita alterações no conteúdo", () => {
      const secret = "test-webhook-secret-not-real";
      const timestamp = "1791728100";
      const requestId = "pix-test-request-01";
      const dataId = "123456789";
      const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
      const digest = createHmac("sha256", secret).update(manifest).digest("hex");
      const signature = `ts=${timestamp},v1=${digest}`;

      expect(verifyMercadoPagoWebhookSignature(signature, requestId, dataId, secret)).toBe(true);
      expect(verifyMercadoPagoWebhookSignature(signature, "different-request", dataId, secret)).toBe(false);
      expect(verifyMercadoPagoWebhookSignature(signature, requestId, "999", secret)).toBe(false);
      expect(verifyMercadoPagoWebhookSignature(undefined, requestId, dataId, secret)).toBe(false);
    });

    it("cria Pix com idempotência e credita exatamente uma vez após aprovação consultada no provedor", async () => {
      const payer = await actor("passenger");
      const original = {
        nodeEnv: process.env.NODE_ENV,
        accessToken: process.env.MP_ACCESS_TOKEN,
        webhookSecret: process.env.MP_WEBHOOK_SECRET,
        webhookUrl: process.env.MERCADO_PAGO_WEBHOOK_URL,
      };
      process.env.NODE_ENV = "test";
      process.env.MP_ACCESS_TOKEN = "test-mp-access-token-not-real";
      process.env.MP_WEBHOOK_SECRET = "test-mp-webhook-secret-not-real";
      process.env.MERCADO_PAGO_WEBHOOK_URL = "http://localhost/api/payments/webhooks/mercadopago";

      let createdPayment: Record<string, unknown> | null = null;
      const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/payments") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            transaction_amount: number;
            external_reference: string;
            metadata: Record<string, unknown>;
            payer: { email: string; identification: { type: string; number: string } };
          };
          expect(body.payer.email).toBe(payer.email);
          expect(body.payer.identification).toEqual({ type: "CPF", number: "52998224725" });
          const headers = init.headers as Record<string, string>;
          expect(headers["X-Idempotency-Key"]).toBeTruthy();
          createdPayment = {
            id: "mp-test-payment-001",
            status: "pending",
            transaction_amount: body.transaction_amount,
            currency_id: "BRL",
            payment_method_id: "pix",
            external_reference: body.external_reference,
            live_mode: false,
            metadata: body.metadata,
            point_of_interaction: {
              transaction_data: {
                qr_code: "000201-pix-payload",
                qr_code_base64: "iVBORw0KGgo=",
                ticket_url: "https://www.mercadopago.com.br/",
              },
            },
          };
          return new Response(JSON.stringify(createdPayment), { status: 201 });
        }
        if (url.endsWith("/v1/payments/mp-test-payment-001") && init?.method === "GET") {
          if (!createdPayment) throw new Error("Create must happen before status lookup");
          return new Response(JSON.stringify({ ...createdPayment, status: "approved" }), { status: 200 });
        }
        throw new Error("Unexpected provider request");
      });

      try {
        const input = {
          userId: payer.id,
          payerEmail: payer.email,
          payerCpf: "529.982.247-25",
          amountCents: 2500,
          idempotencyKey: `pix-${randomUUID()}`,
        };
        const first = await createPixDeposit(input);
        const retry = await createPixDeposit(input);
        expect(first.depositId).toBe(retry.depositId);
        expect(first.qrCode).toBe("000201-pix-payload");
        expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/payments") && call[1]?.method === "POST")).toHaveLength(1);

        expect(await processMercadoPagoPaymentWebhook("mp-test-payment-001")).toBe("credited");
        expect(await processMercadoPagoPaymentWebhook("mp-test-payment-001")).toBe("already_processed");
        expect(await walletEngine.getAvailableBalance(payer.id)).toBe(2500);

        const deposits = await db.select().from(walletDeposits).where(eq(walletDeposits.id, first.depositId));
        expect(deposits).toHaveLength(1);
        expect(deposits[0].status).toBe("approved");
        expect(deposits[0].providerPaymentId).toBe("mp-test-payment-001");

        const wallet = await walletEngine.getWallet(payer.id);
        const credits = await db
          .select({ id: ledger_transactions.id })
          .from(ledger_transactions)
          .where(and(
            eq(ledger_transactions.walletId, wallet!.id),
            eq(ledger_transactions.idempotencyKey, `mercadopago:pix:deposit:${first.depositId}`)
          ));
        expect(credits).toHaveLength(1);
      } finally {
        fetchMock.mockRestore();
        const restore = (name: string, value: string | undefined) => {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        };
        restore("NODE_ENV", original.nodeEnv);
        restore("MP_ACCESS_TOKEN", original.accessToken);
        restore("MP_WEBHOOK_SECRET", original.webhookSecret);
        restore("MERCADO_PAGO_WEBHOOK_URL", original.webhookUrl);
      }
    });
  });

});
