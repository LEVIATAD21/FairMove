/**
 * QA AUDIT — Área 2: máquina de estados de corrida (execução real, não estática).
 *
 * Bugs-alvo desta suíte (encontrados na auditoria):
 *  [BUG-E2] BURACOS de cancelamento na máquina: passageiro não consegue cancelar
 *           em DRIVER_ARRIVING nem DRIVER_AT_PICKUP (deadlock real: sem timeout,
 *           sem taxa de cancelamento, só o motorista ou admin resgatam), e o
 *           motorista não consegue cancelar em DRIVER_ASSIGNED.
 *  [BUG-E3] RACE complete×cancel: o settle (débito/crédito) acontece ANTES do
 *           claim de status — o cancelamento vence o CAS depois do dinheiro
 *           ter sido movido → corrida CANCELLED com passageiro debitado e
 *           motorista creditado, sem estorno algum.
 *  [BUG-E4] EXPIRED inalcançável: nenhum código/job varre corridas presas em
 *           REQUESTED/SEARCHING — a corrida bloqueia "nova corrida ativa" (409)
 *           para SEMPRE e a conta do passageiro fica travada.
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
} from "../packages/shared-db/src/index";
import { walletEngine } from "../packages/wallets/src/engine/wallet-engine";
import { getJwtSecret } from "../packages/auth/src/middleware";
import { authRouter } from "../packages/auth/src/routes";
import { rideRouter } from "../packages/rides/src/routes";

const app = express();
app.use(express.json());
app.use("/api/auth", authRouter);
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
  const email = `qa2-${role}-${id}@qa.it`;
  await db.insert(users).values({
    id,
    name: `QA2 ${role}`,
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
    plate: `QA2${vehicleId.slice(0, 6).toUpperCase()}`,
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

const ADVANCE_CHAIN = ["DRIVER_ARRIVING", "DRIVER_AT_PICKUP", "PASSENGER_ONBOARD", "IN_PROGRESS"];

async function advanceTo(
  rideId: string,
  driver: Awaited<ReturnType<typeof makeDriverOnline>>,
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

async function freeDriver(driverRowId: string): Promise<void> {
  await db.update(drivers).set({ available: true }).where(eq(drivers.id, driverRowId));
}

async function getRideStatus(rideId: string): Promise<string> {
  const rows = await db.select({ status: rides.status }).from(rides).where(eq(rides.id, rideId));
  return rows[0]?.status ?? "MISSING";
}

describeIfDb("QA audit: máquina de estados de corrida", () => {
  const createdUserIds: string[] = [];
  const createdDriverIds: string[] = [];
  const createdVehicleIds: string[] = [];
  let passenger: TestActor;
  let driver: Awaited<ReturnType<typeof makeDriverOnline>>;

  beforeAll(async () => {
    passenger = await makeActor("passenger");
    createdUserIds.push(passenger.id);
    driver = await makeDriverOnline();
    createdUserIds.push(driver.actor.id);
    createdDriverIds.push(driver.driverId);
    createdVehicleIds.push(driver.vehicleId);
    await walletEngine.ensureWallet(passenger.id);
    await walletEngine.creditCents(passenger.id, 2_000_000);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      const rideRows = await db
        .select({ id: rides.id })
        .from(rides)
        .where(inArray(rides.passengerId, createdUserIds));
      const rideIds = rideRows.map((r) => r.id);
      if (rideIds.length > 0) {
        await db
          .delete(rideLocationEvents)
          .where(inArray(rideLocationEvents.rideId, rideIds));
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
      await db
        .delete(verificationTokens)
        .where(inArray(verificationTokens.userId, createdUserIds));
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

  test("[E-1] guards de transição ilegal rejeitam via API (400/404)", async () => {
    // complete fora de IN_PROGRESS (aqui: DRIVER_ASSIGNED) + cancelar duas vezes
    const r1 = await createRide(passenger);
    await request(app)
      .post(`/api/rides/${r1}/accept`)
      .set("Authorization", `Bearer ${driver.actor.token}`);
    const c1 = await request(app)
      .post(`/api/rides/${r1}/complete`)
      .set("Authorization", `Bearer ${driver.actor.token}`);
    expect(c1.status).toBe(400);

    const cancel1 = await request(app)
      .post(`/api/rides/${r1}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reason: "qa" });
    expect(cancel1.status).toBe(200);
    const cancel2 = await request(app)
      .post(`/api/rides/${r1}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reason: "qa again" });
    expect(cancel2.status).toBe(400);

    // skip de estados: DRIVER_ASSIGNED → IN_PROGRESS proibido
    const r2 = await createRide(passenger);
    await request(app)
      .post(`/api/rides/${r2}/accept`)
      .set("Authorization", `Bearer ${driver.actor.token}`);
    const skip = await request(app)
      .patch(`/api/rides/${r2}/status`)
      .set("Authorization", `Bearer ${driver.actor.token}`)
      .send({ status: "IN_PROGRESS" });
    expect(skip.status).toBe(400);

    // COMPLETED não é status avançável pelo motorista
    const patchCompleted = await request(app)
      .patch(`/api/rides/${r2}/status`)
      .set("Authorization", `Bearer ${driver.actor.token}`)
      .send({ status: "COMPLETED" });
    expect(patchCompleted.status).toBe(400);

    // encerra o r2 para não bloquear os próximos testes
    const cancelR2 = await request(app)
      .post(`/api/rides/${r2}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reason: "cleanup" });
    expect(cancelR2.status).toBe(200);

    console.log(
      `[E-1] guards: complete@DRIVER_ASSIGNED=${c1.status} skip=${skip.status} ` +
        `PATCH COMPLETED=${patchCompleted.status} cancel2=${cancel2.status}`
    );
  });

  test("[E-2] passageiro cancela em DRIVER_ARRIVING/DRIVER_AT_PICKUP; motorista cancela em DRIVER_ASSIGNED", async () => {
    // 1) Motorista a caminho: passageiro preso? (pre-fix: 400 — deadlock)
    const p1 = await makeActor("passenger");
    createdUserIds.push(p1.id);
    const r1 = await createRide(p1);
    await request(app)
      .post(`/api/rides/${r1}/accept`)
      .set("Authorization", `Bearer ${driver.actor.token}`);
    await advanceTo(r1, driver, "DRIVER_ARRIVING");
    const c1 = await request(app)
      .post(`/api/rides/${r1}/cancel`)
      .set("Authorization", `Bearer ${p1.token}`)
      .send({ reason: "não quero mais" });
    console.log(`[E-2] cancel passageiro@DRIVER_ARRIVING=${c1.status}`);
    await freeDriver(driver.driverId);

    // 2) Motorista no ponto: passageiro preso? (pre-fix: 400 — deadlock)
    const p2 = await makeActor("passenger");
    createdUserIds.push(p2.id);
    const r2 = await createRide(p2);
    await request(app)
      .post(`/api/rides/${r2}/accept`)
      .set("Authorization", `Bearer ${driver.actor.token}`);
    await advanceTo(r2, driver, "DRIVER_AT_PICKUP");
    const c2 = await request(app)
      .post(`/api/rides/${r2}/cancel`)
      .set("Authorization", `Bearer ${p2.token}`)
      .send({ reason: "motorista não iniciou" });
    console.log(`[E-2] cancel passageiro@DRIVER_AT_PICKUP=${c2.status}`);
    await freeDriver(driver.driverId);

    // 3) Motorista aceitou e desistiu: pode cancelar a própria corrida? (pre-fix: 400)
    const p3 = await makeActor("passenger");
    createdUserIds.push(p3.id);
    const r3 = await createRide(p3);
    await request(app)
      .post(`/api/rides/${r3}/accept`)
      .set("Authorization", `Bearer ${driver.actor.token}`);
    const c3 = await request(app)
      .post(`/api/rides/${r3}/cancel`)
      .set("Authorization", `Bearer ${driver.actor.token}`)
      .send({ reason: "carro quebrou" });
    console.log(`[E-2] cancel motorista@DRIVER_ASSIGNED=${c3.status}`);
    await freeDriver(driver.driverId);

    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    expect(c3.status).toBe(200);
    expect(await getRideStatus(r1)).toBe("CANCELLED_BY_PASSENGER");
    expect(await getRideStatus(r2)).toBe("CANCELLED_BY_PASSENGER");
    expect(await getRideStatus(r3)).toBe("CANCELLED_BY_DRIVER");

    // Motorista liberado após cada cancelamento
    const drv = await db
      .select({ available: drivers.available })
      .from(drivers)
      .where(eq(drivers.id, driver.driverId));
    expect(drv[0].available).toBe(true);
  });

  test("[E-3] race complete×cancel: corrida cancelada NUNCA pode ficar com dinheiro movido", async () => {
    const ITERATIONS = 15;
    let inconsistent = 0;
    let completedOk = 0;
    let cancelledClean = 0;

    for (let i = 0; i < ITERATIONS; i++) {
      const rideId = await createRide(passenger);
      await request(app)
        .post(`/api/rides/${rideId}/accept`)
        .set("Authorization", `Bearer ${driver.actor.token}`);
      await advanceTo(rideId, driver, "IN_PROGRESS");

      const pBefore = await walletEngine.getAvailableBalance(passenger.id);
      const dBefore = await walletEngine.getAvailableBalance(driver.actor.id);
      const rideRow = await db.select().from(rides).where(eq(rides.id, rideId));
      const fare = Number(rideRow[0].finalPassengerPrice);

      // Cancelamento entra na janela entre o load e o CAS do complete
      // (pre-fix: settle acontece ANTES do CAS → janela = duração do settle).
      const staggerMs = 1 + Math.floor(Math.random() * 14);
      const [completeRes, cancelRes] = await Promise.all([
        request(app)
          .post(`/api/rides/${rideId}/complete`)
          .set("Authorization", `Bearer ${driver.actor.token}`),
        new Promise<{ status: number }>((resolve) =>
          setTimeout(() => {
            resolve(
              request(app)
                .post(`/api/rides/${rideId}/cancel`)
                .set("Authorization", `Bearer ${passenger.token}`)
                .send({ reason: "race" })
            );
          }, staggerMs)
        ),
      ]);

      const status = await getRideStatus(rideId);
      const pAfter = await walletEngine.getAvailableBalance(passenger.id);
      const dAfter = await walletEngine.getAvailableBalance(driver.actor.id);
      const pDelta = pBefore - pAfter;
      const dDelta = dAfter - dBefore;

      const cancelled = status.startsWith("CANCELLED");
      const moneyMoved = pDelta > 0 || dDelta > 0;
      if (cancelled && moneyMoved) {
        inconsistent++;
        console.log(
          `[E-3] INCONSISTENTE#${i}: status=${status} passageiro debitado=${pDelta} ` +
            `motorista creditado=${dDelta} (complete=${completeRes.status} cancel=${cancelRes.status})`
        );
      } else if (status === "COMPLETED" && moneyMoved) {
        completedOk++;
        expect(pDelta).toBe(fare);
      } else if (cancelled && !moneyMoved) {
        cancelledClean++;
      } else {
        console.log(
          `[E-3] estado inesperado#${i}: status=${status} pDelta=${pDelta} dDelta=${dDelta} ` +
            `complete=${completeRes.status} cancel=${cancelRes.status}`
        );
      }
      expect(completeRes.status === 200 || completeRes.status === 409 || completeRes.status === 400).toBe(true);
      expect([200, 400, 409].includes(cancelRes.status)).toBe(true);
    }

    console.log(
      `[E-3] ${ITERATIONS} corridas: completed+settled=${completedOk} ` +
        `cancelled+limpo=${cancelledClean} CANCELLED+DINHEIRO=${inconsistent}`
    );
    // Invariante: dinheiro só se move em corrida COMPLETED.
    expect(inconsistent).toBe(0);
  });

  test("[E-4] corrida presa em REQUESTED expira e desbloqueia a conta do passageiro", async () => {
    const victim = await makeActor("passenger");
    createdUserIds.push(victim.id);

    const rideId = await createRide(victim);
    const blocked = await request(app)
      .post("/api/rides")
      .set("Authorization", `Bearer ${victim.token}`)
      .send({
        pickupLocationLat: PICKUP.lat,
        pickupLocationLng: PICKUP.lng,
        dropoffLocationLat: DROPOFF.lat,
        dropoffLocationLng: DROPOFF.lng,
      });
    expect(blocked.status).toBe(409); // corrida ativa bloqueia a conta

    // Envelhece a corrida (simula 2h parada — REQUESTED/SEARCHING nunca expiram
    // sozinhas: nada no código seta EXPIRED e não existe job de timeout).
    await db
      .update(rides)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(rides.id, rideId));

    // Pré-fix: módulo de expiração não existe (RED com mensagem clara).
    let sweep: ((opts?: { now?: Date }) => Promise<number>) | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      sweep = (require("../packages/rides/src/expiry") as { expireStaleRides?: typeof sweep })
        .expireStaleRides;
    } catch {
      sweep = undefined;
    }
    if (!sweep) {
      console.log(
        "[E-4] RED: expireStaleRides NÃO EXISTE — corrida REQUESTED de 2h segue ativa e " +
          "bloqueia nova corrida (409) para sempre; EXPIRED nunca é setado em lugar nenhum."
      );
    }
    expect(typeof sweep).toBe("function");

    const expired = await sweep!();
    expect(expired).toBeGreaterThanOrEqual(1);
    expect(await getRideStatus(rideId)).toBe("EXPIRED");

    const retry = await request(app)
      .post("/api/rides")
      .set("Authorization", `Bearer ${victim.token}`)
      .send({
        pickupLocationLat: PICKUP.lat,
        pickupLocationLng: PICKUP.lng,
        dropoffLocationLat: DROPOFF.lat,
        dropoffLocationLng: DROPOFF.lng,
      });
    console.log(
      `[E-4] sweep expirou=${expired} | nova corrida após expirar: ${retry.status}`
    );
    expect(retry.status).toBe(201);
  });
});
