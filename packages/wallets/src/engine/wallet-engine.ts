import { db, wallets, ledger_transactions, ledger_entries } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

interface TransactionOptions {
  idempotencyKey?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export class WalletEngine {
  async getWallet(userId: string) {
    const wallet = await db.select().from(wallets).where(eq(wallets.userId, userId));
    return wallet.length > 0 ? wallet[0] : null;
  }

  async getAvailableBalance(userId: string) {
    const wallet = await this.getWallet(userId);
    return wallet ? Number(wallet.available_balance) : 0;
  }

  async getPendingBalance(userId: string) {
    const wallet = await this.getWallet(userId);
    return wallet ? Number(wallet.pending_balance) : 0;
  }

  async getReserveBalance(userId: string) {
    const wallet = await this.getWallet(userId);
    return wallet ? Number(wallet.reserve_balance) : 0;
  }

  async creditWallet(
    userId: string,
    amount: number,
    direction: "credit" | "debit",
    options: TransactionOptions = {}
  ): Promise<{
    transactionId: string;
    entryId: string;
    newAvailableBalance: number;
    newPendingBalance: number;
    newReserveBalance: number;
  }> {
    const amountInCents = Math.round(amount * 100);
    const description = options.description || "Wallet operation";

    let wallet = await this.getWallet(userId);
    if (!wallet) {
      const newWallet = await db.insert(wallets).values({
        id: uuidv4(),
        userId,
        available_balance: 0,
        pending_balance: 0,
        reserve_balance: 0,
        currency: "BRL",
      }).returning();

      wallet = newWallet[0];
    }

    const transactionId = uuidv4();

    await db.insert(ledger_transactions).values({
      id: transactionId,
      walletId: wallet.id,
      transactionType: direction,
      amount: amountInCents,
      currency: "BRL",
      description,
      metadata: JSON.stringify(options.metadata || {}),
      status: "completed",
    });

    const entryId = uuidv4();
    const currentAvailable = Number(wallet.available_balance);
    const currentPending = Number(wallet.pending_balance);
    const currentReserve = Number(wallet.reserve_balance);

    let newAvailable = currentAvailable;
    let newPending = currentPending;
    let newReserve = currentReserve;

    if (direction === "credit") {
      newAvailable = currentAvailable + amountInCents;
    } else if (direction === "debit") {
      newAvailable = Math.max(0, currentAvailable - amountInCents);
    }

    await db.insert(ledger_entries).values({
      id: entryId,
      transactionId: transactionId,
      walletId: wallet.id,
      entryType: direction,
      amount: amountInCents,
      balanceAfter: newAvailable + newPending + newReserve,
    });

    await db.update(wallets).set({
      available_balance: newAvailable,
      updated_at: new Date(),
    }).where(eq(wallets.id, wallet.id));

    return {
      transactionId,
      entryId,
      newAvailableBalance: newAvailable,
      newPendingBalance: newPending,
      newReserveBalance: newReserve,
    };
  }

  async contributeToReserve(
    userId: string,
    amount: number,
    _purpose: string,
    _options: TransactionOptions = {}
  ): Promise<{
    transactionId: string;
    entryId: string;
    newReserveBalance: number;
  }> {
    const amountInCents = Math.round(amount * 100);

    const wallet = await this.getWallet(userId);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const currentAvailable = Number(wallet.available_balance);
    const currentReserve = Number(wallet.reserve_balance);

    if (currentAvailable < amountInCents) {
      throw new Error("Insufficient available balance");
    }

    const transactionId = uuidv4();

    await db.insert(ledger_transactions).values({
      id: transactionId,
      walletId: wallet.id,
      transactionType: "reserve_contribution",
      amount: amountInCents,
      currency: "BRL",
      description: "Reserve contribution",
      status: "completed",
    });

    const entryIdAvailable = uuidv4();
    const newAvailable = currentAvailable - amountInCents;

    await db.insert(ledger_entries).values({
      id: entryIdAvailable,
      transactionId: transactionId,
      walletId: wallet.id,
      entryType: "debit",
      amount: amountInCents,
      balanceAfter: newAvailable + currentReserve,
    });

    const entryIdReserve = uuidv4();
    const newReserve = currentReserve + amountInCents;

    await db.insert(ledger_entries).values({
      id: entryIdReserve,
      transactionId: transactionId,
      walletId: wallet.id,
      entryType: "credit",
      amount: amountInCents,
      balanceAfter: newAvailable + newReserve,
    });

    await db.update(wallets).set({
      available_balance: newAvailable,
      reserve_balance: newReserve,
      updated_at: new Date(),
    }).where(eq(wallets.id, wallet.id));

    return {
      transactionId,
      entryId: entryIdAvailable,
      newReserveBalance: newReserve,
    };
  }

  async payoutFromReserve(
    userId: string,
    amount: number,
    _purpose: string,
    _options: TransactionOptions = {}
  ): Promise<{
    transactionId: string;
    entryId: string;
    newReserveBalance: number;
    newAvailableBalance: number;
  }> {
    const amountInCents = Math.round(amount * 100);

    const wallet = await this.getWallet(userId);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const currentReserve = Number(wallet.reserve_balance);
    const currentAvailable = Number(wallet.available_balance);

    if (currentReserve < amountInCents) {
      throw new Error("Insufficient reserve balance");
    }

    const transactionId = uuidv4();

    await db.insert(ledger_transactions).values({
      id: transactionId,
      walletId: wallet.id,
      transactionType: "reserve_payout",
      amount: amountInCents,
      currency: "BRL",
      description: "Reserve payout",
      status: "completed",
    });

    const entryIdReserve = uuidv4();
    const newReserve = currentReserve - amountInCents;

    await db.insert(ledger_entries).values({
      id: entryIdReserve,
      transactionId: transactionId,
      walletId: wallet.id,
      entryType: "debit",
      amount: amountInCents,
      balanceAfter: newReserve + currentAvailable,
    });

    const entryIdAvailable = uuidv4();
    const newAvailable = currentAvailable + amountInCents;

    await db.insert(ledger_entries).values({
      id: entryIdAvailable,
      transactionId: transactionId,
      walletId: wallet.id,
      entryType: "credit",
      amount: amountInCents,
      balanceAfter: newReserve + newAvailable,
    });

    await db.update(wallets).set({
      reserve_balance: newReserve,
      available_balance: newAvailable,
      updated_at: new Date(),
    }).where(eq(wallets.id, wallet.id));

    return {
      transactionId,
      entryId: entryIdReserve,
      newReserveBalance: newReserve,
      newAvailableBalance: newAvailable,
    };
  }
}

export const walletEngine = new WalletEngine();
