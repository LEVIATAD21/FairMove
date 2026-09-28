/**
 * QA AUDIT — Área 5: performance, paginação e ledger (execução real).
 *
 * Bugs-alvo:
 *  [BUG-H1] GET /api/wallets/:userId/transactions (limit 200) e /entries
 *           (limit 500) não tinham ORDER BY: o LIMIT cortava um SUBCONJUTO
 *           arbitrário (ordem física de inserção) — extrato financeiro
 *           mostrava as linhas MAIS VELHAS e escondia as novas em silêncio.
 *  [BUG-H2] Zero índices secundários em todo o banco (só PKs/uniques):
 *           history, sweep de expiração (cron a cada minuto), matching,
 *           extrato e fraud rodavam Seq Scan sempre.
 *  [BUG-H3] GET /api/events/admin/events sem LIMIT: resposta não-bounded.
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
import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  users,
  sessions,
  verificationTokens,
  wallets,
  ledger_transactions,
  ledger_entries,
  events,
} from "../packages/shared-db/src/index";
import { walletEngine } from "../packages/wallets/src/engine/wallet-engine";
import { getJwtSecret } from "../packages/auth/src/middleware";
import { authRouter } from "../packages/auth/src/routes";
import { walletRouter } from "../packages/wallets/src/routes";
import { eventsRouter } from "../packages/events/src/routes";

const app = express();
app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/wallets", walletRouter);
app.use("/api/events", eventsRouter);

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
  const email = `qa5-${role}-${id}@qa.it`;
  await db.insert(users).values({ id, name: `QA5 ${role}`, email, passwordHash: "x", role });
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

const EXPECTED_INDEXES = [
  "idx_rides_passenger_created",
  "idx_rides_driver_created",
  "idx_rides_status_created",
  "idx_drivers_status_available",
  "idx_ledger_tx_wallet_created",
  "idx_ledger_entries_wallet_created",
  "idx_promotion_redemptions_ride",
  "idx_fraud_events_user_type",
  "idx_ride_location_events_ride",
];

describeIfDb("QA audit: performance, paginação e ledger", () => {
  const createdUserIds: string[] = [];
  const seededTxIds: string[] = [];
  const seededEntryIds: string[] = [];
  const seededEventIds: string[] = [];
  let passenger: TestActor;
  let admin: TestActor;
  let walletId: string;

  beforeAll(async () => {
    passenger = await makeActor("passenger");
    admin = await makeActor("admin");
    createdUserIds.push(passenger.id, admin.id);
    await walletEngine.ensureWallet(passenger.id);
    const w = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, passenger.id));
    walletId = w[0].id;
  });

  afterAll(async () => {
    if (seededEntryIds.length > 0) {
      await db.delete(ledger_entries).where(inArray(ledger_entries.id, seededEntryIds));
    }
    if (seededTxIds.length > 0) {
      await db.delete(ledger_transactions).where(inArray(ledger_transactions.id, seededTxIds));
    }
    if (seededEventIds.length > 0) {
      await db.delete(events).where(inArray(events.id, seededEventIds));
    }
    if (createdUserIds.length > 0) {
      const walletRows = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(inArray(wallets.userId, createdUserIds));
      const walletIds = walletRows.map((x) => x.id);
      if (walletIds.length > 0) {
        await db.delete(ledger_entries).where(inArray(ledger_entries.walletId, walletIds));
        await db
          .delete(ledger_transactions)
          .where(inArray(ledger_transactions.walletId, walletIds));
        await db.delete(wallets).where(inArray(wallets.id, walletIds));
      }
      await db.delete(verificationTokens).where(inArray(verificationTokens.userId, createdUserIds));
      await db.delete(sessions).where(inArray(sessions.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  test("[H-1] extrato (transactions/entries) retorna os MAIS RECENTES na ordem certa", async () => {
    const base = Date.now() - 30 * 24 * 3600 * 1000;

    // 205 transações (cap do endpoint é 200) com createdAt crescente.
    const txRows = Array.from({ length: 205 }, (_, i) => ({
      id: randomUUID(),
      walletId,
      transactionType: "deposit",
      amount: 100 + i,
      description: `seed qa5 tx ${i}`,
      idempotencyKey: `qa5tx-${i}`,
      created_at: new Date(base + i * 1000),
    }));
    await db.insert(ledger_transactions).values(txRows);
    seededTxIds.push(...txRows.map((r) => r.id));
    const newestTx = txRows[txRows.length - 1];

    // 505 entradas (cap 500) numa transação carregadora.
    const carrier = txRows[0];
    const entryRows = Array.from({ length: 505 }, (_, i) => ({
      id: randomUUID(),
      transactionId: carrier.id,
      walletId,
      entryType: "credit",
      amount: 1,
      balanceAfter: i,
      created_at: new Date(base + i * 1000),
    }));
    await db.insert(ledger_entries).values(entryRows);
    seededEntryIds.push(...entryRows.map((r) => r.id));
    const newestEntry = entryRows[entryRows.length - 1];

    const txRes = await request(app)
      .get(`/api/wallets/${passenger.id}/transactions`)
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(txRes.status).toBe(200);
    const txList = txRes.body.transactions as { id: string; created_at: string }[];
    const txTimes = txList.map((t) => new Date(t.created_at).getTime());
    const txSortedDesc = txTimes.every((t, i) => i === 0 || txTimes[i - 1] >= t);
    console.log(
      `[H-1] transactions: ${txList.length} linhas | ordenadoDesc=${txSortedDesc} | ` +
        `primeiro=${txList[0]?.id?.slice(0, 8)} (esperado ${newestTx.id.slice(0, 8)})`
    );
    expect(txList.length).toBeLessThanOrEqual(200);
    expect(txSortedDesc).toBe(true); // RED: ordem física ascendente
    expect(txList[0].id).toBe(newestTx.id); // RED: primeiro era o mais antigo

    const enRes = await request(app)
      .get(`/api/wallets/${passenger.id}/entries`)
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(enRes.status).toBe(200);
    const enList = enRes.body.entries as { id: string; created_at: string }[];
    const enTimes = enList.map((t) => new Date(t.created_at).getTime());
    const enSortedDesc = enTimes.every((t, i) => i === 0 || enTimes[i - 1] >= t);
    console.log(
      `[H-1] entries: ${enList.length} linhas | ordenadoDesc=${enSortedDesc} | ` +
        `primeiro=${enList[0]?.id?.slice(0, 8)} (esperado ${newestEntry.id.slice(0, 8)})`
    );
    expect(enList.length).toBeLessThanOrEqual(500);
    expect(enSortedDesc).toBe(true); // RED
    expect(enList[0].id).toBe(newestEntry.id); // RED
  });

  test("[H-3] admin events é bounded (limit 200)", async () => {
    const base = Date.now() - 60 * 24 * 3600 * 1000;
    const rows = Array.from({ length: 201 }, (_, i) => ({
      id: randomUUID(),
      title: `QA5 event ${i}`,
      startDate: new Date(base + i * 60_000),
      endDate: new Date(base + i * 60_000 + 3600_000),
      createdAt: new Date(base + i * 1000),
    }));
    await db.insert(events).values(rows);
    seededEventIds.push(...rows.map((r) => r.id));

    const res = await request(app)
      .get("/api/events/admin/events")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const list = res.body as { id: string; createdAt: string }[];
    console.log(`[H-3] admin/events → ${list.length} linhas (esperado ≤200)`);
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(200); // RED: 201+

    // mantém ordenado desc (invariante já presente na rota)
    const times = list.map((e) => new Date(e.createdAt).getTime());
    const sortedDesc = times.every((t, i) => i === 0 || times[i - 1] >= t);
    expect(sortedDesc).toBe(true);
  });

  test("[H-2] índices secundários criados (guard de regressão)", async () => {
    const res = await db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
    );
    const names = (res.rows as { indexname: string }[]).map((r) => r.indexname);
    const missing = EXPECTED_INDEXES.filter((n) => !names.includes(n));
    console.log(`[H-2] índices ausentes: ${JSON.stringify(missing)}`);
    expect(missing).toEqual([]); // RED pré-migração: todos ausentes
  });
});
