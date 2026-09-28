/**
 * QA AUDIT — Área 4: matching e geolocalização (execução real).
 *
 * Bugs-alvo:
 *  [BUG-G1] POST /api/matching/driver/status aceitava `{available: true}`
 *           de um motorista COM corrida ativa (DRIVER_ASSIGNED+): o guard de
 *           accept é apenas `driver.available`, então o motorista liberava a
 *           si mesmo e aceitava uma 2ª corrida — double-booking total (duas
 *           corridas DRIVER_ASSIGNED para o mesmo motorista).
 *
 * Cenários de sanidade/invariante:
 *  [G-2] driver ocupado/offline não aparece no nearby (admin)
 *  [G-3] coordenada inválida: rota 400 e engine devolve []
 *  [G-4] accept concorrente de 2 motoristas: exatamente 1 vence, o perdedor
 *        volta a ficar available (rollback)
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
import { and, eq, inArray } from "drizzle-orm";
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
import { matchingRouter } from "../packages/matching/src/routes";

const app = express();
app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/rides", rideRouter);
app.use("/api/matching", matchingRouter);

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
  const email = `qa4-${role}-${id}@qa.it`;
  await db.insert(users).values({ id, name: `QA4 ${role}`, email, passwordHash: "x", role });
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

async function makeDriverOnline(): Promise<{ actor: TestActor; driverId: string; vehicleId: string }> {
  const actor = await makeActor("driver");
  const vehicleId = randomUUID();
  await db.insert(vehicles).values({
    id: vehicleId,
    brand: "Test",
    model: "Model",
    year: 2024,
    plate: `QA4${vehicleId.slice(0, 6).toUpperCase()}`,
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
      dropoffLocationLat: DROPOFF.lat,
      dropoffLocationLng: DROPOFF.lng,
    });
  expect(res.status).toBe(201);
  return res.body.rideId as string;
}

const DRIVER_HELD = [
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_AT_PICKUP",
  "PASSENGER_ONBOARD",
  "IN_PROGRESS",
];

async function activeRidesOf(driverId: string): Promise<string[]> {
  const rows = await db
    .select({ id: rides.id, status: rides.status })
    .from(rides)
    .where(and(eq(rides.driverId, driverId), inArray(rides.status, [...DRIVER_HELD])));
  return rows.map((r) => `${r.id}:${r.status}`);
}

describeIfDb("QA audit: matching e geolocalização", () => {
  const createdUserIds: string[] = [];
  const createdDriverIds: string[] = [];
  const createdVehicleIds: string[] = [];
  let passenger: TestActor;
  let passenger2: TestActor;
  let admin: TestActor;
  let driver: Awaited<ReturnType<typeof makeDriverOnline>>;

  beforeAll(async () => {
    passenger = await makeActor("passenger");
    passenger2 = await makeActor("passenger");
    admin = await makeActor("admin");
    createdUserIds.push(passenger.id, passenger2.id, admin.id);
    driver = await makeDriverOnline();
    createdUserIds.push(driver.actor.id);
    createdDriverIds.push(driver.driverId);
    createdVehicleIds.push(driver.vehicleId);
    await walletEngine.ensureWallet(passenger.id);
    await walletEngine.ensureWallet(passenger2.id);
    await walletEngine.creditCents(passenger.id, 2_000_000);
    await walletEngine.creditCents(passenger2.id, 2_000_000);
  });

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

  test("[G-1] motorista com corrida ativa NÃO pode se marcar disponível (double-booking)", async () => {
    const rideId1 = await createRide(passenger);
    const accept1 = await request(app)
      .post(`/api/rides/${rideId1}/accept`)
      .set("Authorization", `Bearer ${driver.actor.token}`);
    expect(accept1.status).toBe(200);

    // O motorista (ou um client bugado) tenta voltar a ficar disponível.
    const statusRes = await request(app)
      .post("/api/matching/driver/status")
      .set("Authorization", `Bearer ${driver.actor.token}`)
      .send({ status: "online", available: true });

    // Com o bug liberado, ele aceita UMA SEGUNDA corrida em paralelo.
    const rideId2 = await createRide(passenger2);
    const accept2 = await request(app)
      .post(`/api/rides/${rideId2}/accept`)
      .set("Authorization", `Bearer ${driver.actor.token}`);

    const active = await activeRidesOf(driver.driverId);
    const drv = (
      await db
        .select({ available: drivers.available, status: drivers.status })
        .from(drivers)
        .where(eq(drivers.id, driver.driverId))
    )[0];
    console.log(
      `[G-1] status→${statusRes.status} | accept2→${accept2.status} | ` +
        `corridas ativas do motorista=${active.length} ${JSON.stringify(active)} | ` +
        `available=${drv.available} status=${drv.status}`
    );

    // Pós-fix: recusa clara, segunda corrida não aceita, 1 corrida ativa.
    expect(statusRes.status).toBe(409); // RED: 200
    expect(accept2.status).toBe(409); // RED: 200
    expect(active.length).toBe(1); // RED: 2 (double-booking)

    // Encerra a corrida para liberar o motorista.
    const cancel = await request(app)
      .post(`/api/rides/${rideId1}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reason: "fim do G-1" });
    expect(cancel.status).toBe(200);
    const after = (
      await db
        .select({ available: drivers.available })
        .from(drivers)
        .where(eq(drivers.id, driver.driverId))
    )[0];
    expect(after.available).toBe(true);
    const activeAfter = await activeRidesOf(driver.driverId);
    expect(activeAfter.length).toBe(0);
  });

  test("[G-2] nearby não lista motorista ocupado nem offline", async () => {
    // driver fica ocupado numa corrida
    const rideId = await createRide(passenger);
    const accept = await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver.actor.token}`);
    expect(accept.status).toBe(200);

    const busy = await request(app)
      .get(
        `/api/matching/drivers/nearby?lat=${PICKUP.lat}&lng=${PICKUP.lng}&radiusKm=10`
      )
      .set("Authorization", `Bearer ${admin.token}`);
    expect(busy.status).toBe(200);
    const busyIds = (busy.body.drivers as { driverId: string }[]).map((d) => d.driverId);
    console.log(`[G-2] nearby com motorista ocupado → ${JSON.stringify(busyIds)}`);
    expect(busyIds).not.toContain(driver.driverId);

    // offline também some
    const off = await request(app)
      .post("/api/matching/driver/status")
      .set("Authorization", `Bearer ${driver.actor.token}`)
      .send({ status: "offline" });
    expect(off.status).toBe(200);

    // termina a corrida (cancel) e reativa para os próximos testes
    const cancel = await request(app)
      .post(`/api/rides/${rideId}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reason: "fim do G-2" });
    expect(cancel.status).toBe(200);
    const back = await request(app)
      .post("/api/matching/driver/status")
      .set("Authorization", `Bearer ${driver.actor.token}`)
      .send({ status: "online" });
    expect(back.status).toBe(200);
    const online = await request(app)
      .get(
        `/api/matching/drivers/nearby?lat=${PICKUP.lat}&lng=${PICKUP.lng}&radiusKm=10`
      )
      .set("Authorization", `Bearer ${admin.token}`);
    expect(online.status).toBe(200);
    const onlineIds = (online.body.drivers as { driverId: string }[]).map((d) => d.driverId);
    console.log(`[G-2] nearby online → ${JSON.stringify(onlineIds)}`);
    expect(onlineIds).toContain(driver.driverId);
  });

  test("[G-3] coordenada inválida: rota 400 e engine devolve []", async () => {
    const bad = await request(app)
      .get("/api/matching/drivers/nearby?lat=999&lng=0")
      .set("Authorization", `Bearer ${admin.token}`);
    console.log(`[G-3] lat=999 → ${bad.status}`);
    expect(bad.status).toBe(400);

    const { findNearbyDrivers } = await import(
      "../packages/matching/src/engine/matching-engine"
    );
    const nan = await findNearbyDrivers(Number.NaN, Number.NaN);
    const out = await findNearbyDrivers(0, 0);
    console.log(`[G-3] engine NaN=${nan.length} longe=${out.length}`);
    expect(nan).toEqual([]);
    expect(out).toEqual([]);
  });

  test("[G-4] accept concorrente: exatamente 1 vence e o perdedor volta a ficar disponível", async () => {
    const driverB = await makeDriverOnline();
    createdUserIds.push(driverB.actor.id);
    createdDriverIds.push(driverB.driverId);
    createdVehicleIds.push(driverB.vehicleId);

    const rideId = await createRide(passenger);
    const [a1, a2] = await Promise.all([
      request(app)
        .post(`/api/rides/${rideId}/accept`)
        .set("Authorization", `Bearer ${driver.actor.token}`),
      request(app)
        .post(`/api/rides/${rideId}/accept`)
        .set("Authorization", `Bearer ${driverB.actor.token}`),
    ]);
    const statuses = [a1.status, a2.status].sort();
    const winner = a1.status === 200 ? driver.driverId : driverB.driverId;
    const loser = a1.status === 200 ? driverB.driverId : driver.driverId;
    const ride = (
      await db
        .select({ driverId: rides.driverId, status: rides.status })
        .from(rides)
        .where(eq(rides.id, rideId))
    )[0];
    const loserRow = (
      await db
        .select({ available: drivers.available })
        .from(drivers)
        .where(eq(drivers.id, loser))
    )[0];
    const winnerRow = (
      await db
        .select({ available: drivers.available })
        .from(drivers)
        .where(eq(drivers.id, winner))
    )[0];
    console.log(
      `[G-4] statuses=${JSON.stringify(statuses)} ride.driverId=${ride.driverId} ` +
        `status=${ride.status} vencedor.available=${winnerRow.available} perdedor.available=${loserRow.available}`
    );
    // Exatamente 1 vence; o perdedor recebe 4xx (409 pelo claim ou 400 se o
    // load já viu DRIVER_ASSIGNED — os dois caminhos recusam corretamente).
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    expect(statuses[1]).toBeLessThan(500);
    expect(ride.driverId).toBe(winner);
    expect(ride.status).toBe("DRIVER_ASSIGNED");
    expect(winnerRow.available).toBe(false);
    expect(loserRow.available).toBe(true);

    const cancel = await request(app)
      .post(`/api/rides/${rideId}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reason: "fim do G-4" });
    expect(cancel.status).toBe(200);
  });
});
