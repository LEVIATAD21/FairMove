import {
  db,
  wallets,
  ledger_transactions,
  ledger_entries,
  type Executor,
} from "@fairmove/shared-db";
import { eq, and, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

type Exec = Executor;

export class InsufficientFundsError extends Error {
  constructor() {
    super("Insufficient available balance");
    this.name = "InsufficientFundsError";
  }
}

export class InsufficientReserveError extends Error {
  constructor() {
    super("Insufficient reserve balance");
    this.name = "InsufficientReserveError";
  }
}

export class InvalidAmountError extends Error {
  constructor(message = "Amount must be a positive number") {
    super(message);
    this.name = "InvalidAmountError";
  }
}

export class DuplicateOperationError extends Error {
  readonly existingTransactionId: string;
  constructor(existingTransactionId: string) {
    super("Operation already executed (idempotency key reused)");
    this.name = "DuplicateOperationError";
    this.existingTransactionId = existingTransactionId;
  }
}

interface TransactionOptions {
  idempotencyKey?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface WalletOperationResult {
  transactionId: string;
  entryId: string;
  newAvailableBalance: number;
  newPendingBalance: number;
  newReserveBalance: number;
}

/** Limite de segurança: R$ 10.000.000,00 por operação. */
const MAX_CENTS = 1_000_000_000;

function toCents(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidAmountError("Amount must be a finite number");
  }
  const cents = Math.round(value * 100);
  if (cents <= 0) throw new InvalidAmountError();
  if (cents > MAX_CENTS) {
    throw new InvalidAmountError("Amount exceeds the maximum allowed");
  }
  return cents;
}

async function findByIdempotencyKey(exec: Exec, key: string) {
  const rows = await exec
    .select({ id: ledger_transactions.id })
    .from(ledger_transactions)
    .where(sql`${ledger_transactions.idempotencyKey} = ${key}`)
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

/**
 * Carteira com livro-razão de entrada dupla.
 *
 * Invariantes:
 * - valores internos sempre em centavos (inteiros);
 * - débito é atômico e nunca deixa o saldo negativo (fundo insuficiente → erro);
 * - todas as escritas (saldo + transação + entrada do livro) ocorrem na MESMA
 *   transação de banco (`withTransaction`) — crash entre elas não existe;
 * - `idempotencyKey` é checado DENTRO da transação e tem UNIQUE no banco:
 *   corrida de duas chamadas com a mesma chave → a segunda recebe
 *   DuplicateOperationError e o rollback desfaz qualquer saldo tocado.
 */
export class WalletEngine {
  /**
   * Garante atomicidade saldo+ledger. Se o chamador já está dentro de uma
   * transação do Drizzle (reserves/settlement passam `tx`), reaproveita —
   * nunca aninhamos; caso contrário abrimos uma transação nova.
   */
  private async withTransaction<T>(exec: Exec, fn: (tx: Exec) => Promise<T>): Promise<T> {
    if (exec !== db) return fn(exec);
    return db.transaction((tx) => fn(tx));
  }

  /** Deve ser chamado DENTRO da transação (a checagem fora é TOCTOU). */
  private async assertIdempotency(tx: Exec, key: string | undefined): Promise<void> {
    if (!key) return;
    const existing = await findByIdempotencyKey(tx, key);
    if (existing) throw new DuplicateOperationError(existing.id);
  }

  /**
   * Insert da transação do ledger com tratamento de corrida: se outra
   * requisição já commitou a mesma idempotencyKey (UNIQUE), lançamos
   * DuplicateOperationError e o rollback desfaz o UPDATE de saldo desta tx.
   */
  private async insertLedgerTransaction(
    tx: Exec,
    values: (typeof ledger_transactions.$inferInsert)
  ): Promise<void> {
    try {
      await tx.insert(ledger_transactions).values(values);
    } catch (error) {
      const key = values.idempotencyKey ?? undefined;
      if (isUniqueViolation(error) && key) {
        const existing = await findByIdempotencyKey(tx, key);
        throw new DuplicateOperationError(existing?.id ?? values.id ?? uuidv4());
      }
      throw error;
    }
  }

  async getWallet(userId: string, exec: Exec = db) {
    const wallet = await exec.select().from(wallets).where(eq(wallets.userId, userId));
    return wallet.length > 0 ? wallet[0] : null;
  }

  async ensureWallet(userId: string, exec: Exec = db) {
    const existing = await this.getWallet(userId, exec);
    if (existing) return existing;

    try {
      const created = await exec
        .insert(wallets)
        .values({
          id: uuidv4(),
          userId,
          available_balance: 0,
          pending_balance: 0,
          reserve_balance: 0,
          currency: "BRL",
        })
        .returning();
      return created[0];
    } catch (error) {
      // Corrida: outra requisição criou a carteira primeiro.
      const again = await this.getWallet(userId, exec);
      if (again) return again;
      throw error;
    }
  }

  async getAvailableBalance(userId: string): Promise<number> {
    const wallet = await this.getWallet(userId);
    return wallet ? Number(wallet.available_balance) : 0;
  }

  async getPendingBalance(userId: string): Promise<number> {
    const wallet = await this.getWallet(userId);
    return wallet ? Number(wallet.pending_balance) : 0;
  }

  async getReserveBalance(userId: string): Promise<number> {
    const wallet = await this.getWallet(userId);
    return wallet ? Number(wallet.reserve_balance) : 0;
  }

  /** Crédito em centavos — atômico (saldo + ledger na mesma transação). */
  async creditCents(
    userId: string,
    cents: number,
    options: TransactionOptions = {},
    exec: Exec = db
  ): Promise<WalletOperationResult> {
    if (!Number.isInteger(cents) || cents <= 0) throw new InvalidAmountError();

    return this.withTransaction(exec, async (tx) => {
      await this.assertIdempotency(tx, options.idempotencyKey);

      const wallet = await this.ensureWallet(userId, tx);

      const updated = await tx
        .update(wallets)
        .set({
          available_balance: sql`${wallets.available_balance} + ${cents}`,
          updated_at: new Date(),
        })
        .where(eq(wallets.id, wallet.id))
        .returning();

      const after = updated[0];
      const transactionId = uuidv4();
      const entryId = uuidv4();

      await this.insertLedgerTransaction(tx, {
        id: transactionId,
        walletId: wallet.id,
        transactionType: "credit",
        amount: cents,
        currency: "BRL",
        description: options.description || "Wallet credit",
        metadata: JSON.stringify(options.metadata || {}),
        status: "completed",
        idempotencyKey: options.idempotencyKey ?? null,
      });

      const totalAfter =
        Number(after.available_balance) +
        Number(after.pending_balance) +
        Number(after.reserve_balance);

      await tx.insert(ledger_entries).values({
        id: entryId,
        transactionId,
        walletId: wallet.id,
        entryType: "credit",
        amount: cents,
        balanceAfter: totalAfter,
      });

      return {
        transactionId,
        entryId,
        newAvailableBalance: Number(after.available_balance),
        newPendingBalance: Number(after.pending_balance),
        newReserveBalance: Number(after.reserve_balance),
      };
    });
  }

  /** Débito em centavos — atômico, sem saldo negativo, ledger na mesma tx. */
  async debitCents(
    userId: string,
    cents: number,
    options: TransactionOptions = {},
    exec: Exec = db
  ): Promise<WalletOperationResult> {
    if (!Number.isInteger(cents) || cents <= 0) throw new InvalidAmountError();

    return this.withTransaction(exec, async (tx) => {
      await this.assertIdempotency(tx, options.idempotencyKey);

      const wallet = await this.ensureWallet(userId, tx);

      const updated = await tx
        .update(wallets)
        .set({
          available_balance: sql`${wallets.available_balance} - ${cents}`,
          updated_at: new Date(),
        })
        .where(and(eq(wallets.id, wallet.id), sql`${wallets.available_balance} >= ${cents}`))
        .returning();

      if (updated.length === 0) {
        throw new InsufficientFundsError();
      }

      const after = updated[0];
      const transactionId = uuidv4();
      const entryId = uuidv4();

      await this.insertLedgerTransaction(tx, {
        id: transactionId,
        walletId: wallet.id,
        transactionType: "debit",
        amount: cents,
        currency: "BRL",
        description: options.description || "Wallet debit",
        metadata: JSON.stringify(options.metadata || {}),
        status: "completed",
        idempotencyKey: options.idempotencyKey ?? null,
      });

      const totalAfter =
        Number(after.available_balance) +
        Number(after.pending_balance) +
        Number(after.reserve_balance);

      await tx.insert(ledger_entries).values({
        id: entryId,
        transactionId,
        walletId: wallet.id,
        entryType: "debit",
        amount: cents,
        balanceAfter: totalAfter,
      });

      return {
        transactionId,
        entryId,
        newAvailableBalance: Number(after.available_balance),
        newPendingBalance: Number(after.pending_balance),
        newReserveBalance: Number(after.reserve_balance),
      };
    });
  }

  /**
   * Crédito direto no saldo de reserva (ex.: parte da assinatura paga pela
   * plataforma). Não altera o saldo disponível.
   */
  async creditReserveCents(
    userId: string,
    cents: number,
    options: TransactionOptions = {},
    exec: Exec = db
  ): Promise<WalletOperationResult> {
    if (!Number.isInteger(cents) || cents <= 0) throw new InvalidAmountError();

    return this.withTransaction(exec, async (tx) => {
      await this.assertIdempotency(tx, options.idempotencyKey);

      const wallet = await this.ensureWallet(userId, tx);

      const updated = await tx
        .update(wallets)
        .set({
          reserve_balance: sql`${wallets.reserve_balance} + ${cents}`,
          updated_at: new Date(),
        })
        .where(eq(wallets.id, wallet.id))
        .returning();

      const after = updated[0];
      const transactionId = uuidv4();
      const entryId = uuidv4();

      await this.insertLedgerTransaction(tx, {
        id: transactionId,
        walletId: wallet.id,
        transactionType: "reserve_credit",
        amount: cents,
        currency: "BRL",
        description: options.description || "Reserve credit",
        metadata: JSON.stringify(options.metadata || {}),
        status: "completed",
        idempotencyKey: options.idempotencyKey ?? null,
      });

      await tx.insert(ledger_entries).values({
        id: entryId,
        transactionId,
        walletId: wallet.id,
        entryType: "credit",
        amount: cents,
        balanceAfter:
          Number(after.available_balance) +
          Number(after.pending_balance) +
          Number(after.reserve_balance),
      });

      return {
        transactionId,
        entryId,
        newAvailableBalance: Number(after.available_balance),
        newPendingBalance: Number(after.pending_balance),
        newReserveBalance: Number(after.reserve_balance),
      };
    });
  }

  /**
   * Crédito/débito em reais (API legada). `amount` é em BRL.
   * Use `creditCents`/`debitCents` em novos código.
   */
  async creditWallet(
    userId: string,
    amount: number,
    direction: "credit" | "debit",
    options: TransactionOptions = {},
    exec: Exec = db
  ): Promise<WalletOperationResult> {
    const cents = toCents(amount);
    if (direction === "credit") {
      return this.creditCents(userId, cents, options, exec);
    }
    return this.debitCents(userId, cents, options, exec);
  }

  /** Move valor de `available` para `reserve` na carteira do usuário. */
  async moveAvailableToReserveCents(
    userId: string,
    cents: number,
    options: TransactionOptions = {},
    exec: Exec = db
  ): Promise<WalletOperationResult> {
    if (!Number.isInteger(cents) || cents <= 0) throw new InvalidAmountError();

    return this.withTransaction(exec, async (tx) => {
      await this.assertIdempotency(tx, options.idempotencyKey);

      const wallet = await this.ensureWallet(userId, tx);

      const updated = await tx
        .update(wallets)
        .set({
          available_balance: sql`${wallets.available_balance} - ${cents}`,
          reserve_balance: sql`${wallets.reserve_balance} + ${cents}`,
          updated_at: new Date(),
        })
        .where(and(eq(wallets.id, wallet.id), sql`${wallets.available_balance} >= ${cents}`))
        .returning();

      if (updated.length === 0) throw new InsufficientFundsError();

      const after = updated[0];
      const transactionId = uuidv4();
      const entryId = uuidv4();

      await this.insertLedgerTransaction(tx, {
        id: transactionId,
        walletId: wallet.id,
        transactionType: "reserve_contribution",
        amount: cents,
        currency: "BRL",
        description: options.description || "Reserve contribution",
        metadata: JSON.stringify(options.metadata || {}),
        status: "completed",
        idempotencyKey: options.idempotencyKey ?? null,
      });

      await tx.insert(ledger_entries).values({
        id: entryId,
        transactionId,
        walletId: wallet.id,
        entryType: "debit",
        amount: cents,
        balanceAfter:
          Number(after.available_balance) +
          Number(after.pending_balance) +
          Number(after.reserve_balance),
      });

      return {
        transactionId,
        entryId,
        newAvailableBalance: Number(after.available_balance),
        newPendingBalance: Number(after.pending_balance),
        newReserveBalance: Number(after.reserve_balance),
      };
    });
  }

  /** Move valor de `reserve` para `available` na carteira do usuário. */
  async moveReserveToAvailableCents(
    userId: string,
    cents: number,
    options: TransactionOptions = {},
    exec: Exec = db
  ): Promise<WalletOperationResult> {
    if (!Number.isInteger(cents) || cents <= 0) throw new InvalidAmountError();

    return this.withTransaction(exec, async (tx) => {
      await this.assertIdempotency(tx, options.idempotencyKey);

      const wallet = await this.ensureWallet(userId, tx);

      const updated = await tx
        .update(wallets)
        .set({
          available_balance: sql`${wallets.available_balance} + ${cents}`,
          reserve_balance: sql`${wallets.reserve_balance} - ${cents}`,
          updated_at: new Date(),
        })
        .where(and(eq(wallets.id, wallet.id), sql`${wallets.reserve_balance} >= ${cents}`))
        .returning();

      if (updated.length === 0) throw new InsufficientReserveError();

      const after = updated[0];
      const transactionId = uuidv4();
      const entryId = uuidv4();

      await this.insertLedgerTransaction(tx, {
        id: transactionId,
        walletId: wallet.id,
        transactionType: "reserve_payout",
        amount: cents,
        currency: "BRL",
        description: options.description || "Reserve payout",
        metadata: JSON.stringify(options.metadata || {}),
        status: "completed",
        idempotencyKey: options.idempotencyKey ?? null,
      });

      await tx.insert(ledger_entries).values({
        id: entryId,
        transactionId,
        walletId: wallet.id,
        entryType: "credit",
        amount: cents,
        balanceAfter:
          Number(after.available_balance) +
          Number(after.pending_balance) +
          Number(after.reserve_balance),
      });

      return {
        transactionId,
        entryId,
        newAvailableBalance: Number(after.available_balance),
        newPendingBalance: Number(after.pending_balance),
        newReserveBalance: Number(after.reserve_balance),
      };
    });
  }

  /** Compatibilidade com a API antiga (valores em BRL). */
  async contributeToReserve(
    userId: string,
    amount: number,
    _purpose: string,
    options: TransactionOptions = {},
    exec: Exec = db
  ): Promise<{ transactionId: string; entryId: string; newReserveBalance: number }> {
    const cents = toCents(amount);
    const result = await this.moveAvailableToReserveCents(userId, cents, options, exec);
    return {
      transactionId: result.transactionId,
      entryId: result.entryId,
      newReserveBalance: result.newReserveBalance,
    };
  }

  /** Compatibilidade com a API antiga (valores em BRL). */
  async payoutFromReserve(
    userId: string,
    amount: number,
    _purpose: string,
    options: TransactionOptions = {},
    exec: Exec = db
  ): Promise<{
    transactionId: string;
    entryId: string;
    newReserveBalance: number;
    newAvailableBalance: number;
  }> {
    const cents = toCents(amount);
    const result = await this.moveReserveToAvailableCents(userId, cents, options, exec);
    return {
      transactionId: result.transactionId,
      entryId: result.entryId,
      newReserveBalance: result.newReserveBalance,
      newAvailableBalance: result.newAvailableBalance,
    };
  }
}

export const walletEngine = new WalletEngine();
