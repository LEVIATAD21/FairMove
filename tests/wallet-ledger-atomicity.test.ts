/**
 * Integridade do ledger (double-spend / atomicidade).
 *
 * Prova que as correções de segurança do WalletEngine impedem:
 * 1. débito duplicado com a mesma idempotencyKey sob concorrência (TOCTOU);
 * 2. saldo negativo em débitos concorrentes sem chave (corrida clássica);
 * 3. ledger órfão (transação de ledger sem correspondência em saldo).
 *
 * Requer DATABASE_URL com o schema aplicado (pnpm db:migrate).
 * Sem banco disponível o suite é pulado (CI sem serviço Postgres não falha).
 */
import "dotenv/config";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

import { walletEngine, DuplicateOperationError, InsufficientFundsError } from "../packages/wallets/src/engine/wallet-engine";
import { db, wallets, ledger_transactions, ledger_entries } from "../packages/shared-db/src/index";
import { eq, and, sql, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

describeIfDb("wallet ledger — atomicidade e double-spend", () => {
  const userId = `it-ledger-${randomUUID()}`;
  const cleanupUserIds: string[] = [userId];

  beforeAll(async () => {
    await walletEngine.ensureWallet(userId);
    await walletEngine.creditCents(userId, 1_000); // R$ 10,00
  });

  afterAll(async () => {
    const uids = cleanupUserIds;
    const walletRows = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(inArray(wallets.userId, uids));
    const walletIds = walletRows.map((w) => w.id);
    if (walletIds.length > 0) {
      await db.delete(ledger_entries).where(inArray(ledger_entries.walletId, walletIds));
      await db.delete(ledger_transactions).where(inArray(ledger_transactions.walletId, walletIds));
      await db.delete(wallets).where(inArray(wallets.userId, uids));
    }
  });

  it("idempotencyKey: 5 débitos concorrentes com a MESMA chave executam exatamente 1", async () => {
    const key = `race-${randomUUID()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => walletEngine.debitCents(userId, 300, { idempotencyKey: key }))
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const duplicated = results.filter(
      (r): r is PromiseRejectedResult =>
        r.status === "rejected" && r.reason instanceof DuplicateOperationError
    );
    const unexpected = results.filter(
      (r): r is PromiseRejectedResult =>
        r.status === "rejected" && !(r.reason instanceof DuplicateOperationError)
    );

    // Nenhuma falha fora do esperado (timeouts, deadlock, etc).
    expect(unexpected).toHaveLength(0);
    expect(fulfilled).toHaveLength(1);
    expect(duplicated).toHaveLength(4);

    // Só 1 débito de R$3,00 efetivado sobre R$10,00 → R$7,00.
    const balance = await walletEngine.getAvailableBalance(userId);
    expect(balance).toBe(700);

    // Ledger: exatamente 1 transação com aquela chave.
    const rows = await db
      .select({ id: ledger_transactions.id })
      .from(ledger_transactions)
      .where(eq(ledger_transactions.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  it("double-spend: 5 débitos concorrentes de R$3,00 sem chave nunca deixam saldo negativo", async () => {
    const balanceBefore = await walletEngine.getAvailableBalance(userId);
    expect(balanceBefore).toBe(700); // R$7,00 após o teste anterior

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => walletEngine.debitCents(userId, 300))
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    // Toda rejeição é apenas "fundo insuficiente" — nunca erro inesperado.
    expect(rejected.every((r) => r.reason instanceof InsufficientFundsError)).toBe(true);

    const balance = await walletEngine.getAvailableBalance(userId);
    expect(balance).toBeGreaterThanOrEqual(0);
    // R$7,00 → no máximo 2 débitos de R$3,00 cabem (sobram R$1,00).
    expect(ok.length).toBeLessThanOrEqual(2);
    expect(balance).toBe(balanceBefore - ok.length * 300);

    // Ledger bate 1:1 com os créditos executados (sem lançamento órfão).
    const walletRow = await walletEngine.getWallet(userId);
    expect(walletRow).not.toBeNull();
    const txCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ledger_transactions)
      .where(
        and(
          eq(ledger_transactions.walletId, walletRow!.id),
          eq(ledger_transactions.transactionType, "debit")
        )
      );
    const entryCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ledger_entries)
      .where(and(eq(ledger_entries.walletId, walletRow!.id), eq(ledger_entries.entryType, "debit")));
    expect(txCount[0].n).toBe(entryCount[0].n);
  });

  it("débito rejeitado (saldo insuficiente) não grava nada no ledger", async () => {
    const walletRow = await walletEngine.getWallet(userId);
    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ledger_transactions)
      .where(eq(ledger_transactions.walletId, walletRow!.id));

    const balance = await walletEngine.getAvailableBalance(userId);
    await expect(walletEngine.debitCents(userId, balance + 100_000)).rejects.toThrow(
      InsufficientFundsError
    );

    const after = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ledger_transactions)
      .where(eq(ledger_transactions.walletId, walletRow!.id));
    expect(after[0].n).toBe(before[0].n);
  });
});
