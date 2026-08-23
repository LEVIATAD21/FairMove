import { db } from "../db";
import { wallets, wallet_accounts, ledger_transactions, ledger_entries, reserve_transactions } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

interface TransactionOptions {
  idempotencyKey?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export class WalletEngine {
  constructor(private db = db) {}

  async getWallet(userId: string) {
    const wallet = db.select().from(wallets).where(eq(wallets.userId, userId));
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
    const idempotencyKey = options.idempotencyKey || uuidv4();
    const amountInCents = Math.round(amount * 100);
    const description = options.description || "Wallet operation";

    // Check if wallet exists, create if not
    let wallet = await this.getWallet(userId);
    if (!wallet) {
      const newWallet = db.insert(wallets).values({
        id: uuidv4(),
        userId,
        available_balance: "0",
        pending_balance: "0",
        reserve_balance: "0",
        currency: "BRL",
      }).returning();

      wallet = newWallet[0];
    }

    // Begin transaction
    const transactionId = uuidv4();

    // Create ledger transaction
    await db.insert(ledger_transactions).values({
      id: transactionId,
      transaction_id: idempotencyKey,
      source_account: "wallet_operations",
      destination_account: userId,
      amount: amountInCents,
      currency: "BRL",
      direction: direction,
      status: "completed",
      description,
      metadata: JSON.stringify(options.metadata || {}),
    });

    // Create ledger entry
    const entryId = uuidv4();
    const currentAvailable = Number(wallet.available_balance);
    const currentPending = Number(wallet.pending_balance);
    const currentReserve = Number(wallet.reserve_balance);

    let newAvailable = currentAvailable;
    let newPending = currentPending;
    let newReserve = currentReserve;

    // Apply the credit/debit to the appropriate balance
    if (direction === "credit") {
      newAvailable = currentAvailable + amountInCents;
    } else if (direction === "debit") {
      newAvailable = Math.max(0, currentAvailable - amountInCents);
    }

    // Create ledger entry
    await db.insert(ledger_entries).values({
      id: entryId,
      entry_id: uuidv4(),
      transaction_id: transactionId,
      account_id: userId,
      amount: amountInCents,
      balance_after: newAvailable + newPending + newReserve,
      entry_type: direction,
    });

    // Update wallet balance
    const updateData: any = {
      available_balance: newAvailable.toString(),
      updated_at: new Date(),
    };

    // If it's a debit that comes from pending, reduce pending
    if (direction === "debit" && newAvailable < currentAvailable) {
      const reduction = currentAvailable - newAvailable;
      newPending = Math.max(0, currentPending - reduction);
      updateData.available_balance = newAvailable.toString();
    }

    await db.update(wallets).set(updateData).where(eq(wallets.id, wallet.id));

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
    purpose: string,
    options: TransactionOptions = {}
  ): Promise<{
    transactionId: string;
    entryId: string;
    newReserveBalance: number;
  }> {
    const idempotencyKey = options.idempotencyKey || uuidv4();
    const amountInCents = Math.round(amount * 100);
    const description = options.description || "Reserve contribution";

    // Get current wallet and reserve
    const wallet = await this.getWallet(userId);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const currentAvailable = Number(wallet.available_balance);
    const currentReserve = Number(wallet.reserve_balance);

    // Check if enough available balance
    if (currentAvailable < amountInCents) {
      throw new Error("Insufficient available balance");
    }

    const transactionId = uuidv4();

    // Create ledger transaction - debit from available, credit to reserve
    await db.insert(ledger_transactions).values({
      id: transactionId,
      transaction_id: idempotencyKey,
      source_account: "available_wallet",
      destination_account: "reserve_wallet",
      amount: amountInCents,
      currency: "BRL",
      direction: "credit", // Credit to reserve
      status: "completed",
      description,
      metadata: JSON.stringify(options.metadata || { purpose }),
    });

    // Create ledger entry for available balance debit
    const entryIdAvailable = uuidv4();
    const newAvailable = currentAvailable - amountInCents;

    await db.insert(ledger_entries).values({
      id: entryIdAvailable,
      entry_id: uuidv4(),
      transaction_id: transactionId,
      account_id: userId,
      amount: amountInCents,
      balance_after: newAvailable + currentReserve,
      entry_type: "debit",
    });

    // Create ledger entry for reserve balance credit
    const entryIdReserve = uuidv4();
    const newReserve = currentReserve + amountInCents;

    await db.insert(ledger_entries).values({
      id: entryIdReserve,
      entry_id: uuidv4(),
      transaction_id: transactionId,
      account_id: userId,
      amount: amountInCents,
      balance_after: newAvailable + newReserve,
      entry_type: "credit",
    });

    // Update wallet - reduce available, increase reserve
    await db.update(wallets).set({
      available_balance: newAvailable.toString(),
      reserve_balance: newReserve.toString(),
      updated_at: new Date(),
    }).where(eq(wallets.id, wallet.id));

    // Create reserve transaction record
    await db.insert(reserve_transactions).values({
      id: uuidv4(),
      reserve_id: uuidv4(),
      source: "ride_payment",
      amount: amountInCents,
      currency: "BRL",
      status: "completed",
      purpose,
      description,
      metadata: JSON.stringify(options.metadata || {}),
    });

    return {
      transactionId,
      entryId: entryIdAvailable, // Primary entry ID
      newReserveBalance: newReserve,
    };
  }

  async payoutFromReserve(
    userId: string,
    amount: number,
    purpose: string,
    options: TransactionOptions = {}
  ): Promise<{
    transactionId: string;
    entryId: string;
    newReserveBalance: number;
    newAvailableBalance: number;
  }> {
    const idempotencyKey = options.idempotencyKey || uuidv4();
    const amountInCents = Math.round(amount * 100);
    const description = options.description || "Reserve payout";

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

    // Create ledger transaction - debit from reserve, credit to available
    await db.insert(ledger_transactions).values({
      id: transactionId,
      transaction_id: idempotencyKey,
      source_account: "reserve_wallet",
      destination_account: "available_wallet",
      amount: amountInCents,
      currency: "BRL",
      direction: "debit", // Debit from reserve
      status: "completed",
      description,
      metadata: JSON.stringify(options.metadata || { purpose }),
    });

    // Create ledger entry for reserve balance debit
    const entryIdReserve = uuidv4();
    const newReserve = currentReserve - amountInCents;

    await db.insert(ledger_entries).values({
      id: entryIdReserve,
      entry_id: uuidv4(),
      transaction_id: transactionId,
      account_id: userId,
      amount: amountInCents,
      balance_after: newReserve + currentAvailable,
      entry_type: "debit",
    });

    // Create ledger entry for available balance credit
    const entryIdAvailable = uuidv4();
    const newAvailable = currentAvailable + amountInCents;

    await db.insert(ledger_entries).values({
      id: entryIdAvailable,
      entry_id: uuidv4(),
      transaction_id: transactionId,
      account_id: userId,
      amount: amountInCents,
      balance_after: newReserve + newAvailable,
      entry_type: "credit",
    });

    // Update wallet - reduce reserve, increase available
    await db.update(wallets).set({
      reserve_balance: newReserve.toString(),
      available_balance: newAvailable.toString(),
      updated_at: new Date(),
    }).where(eq(wallets.id, wallet.id));

    // Create reserve transaction record
    await db.insert(reserve_transactions).values({
      id: uuidv4(),
      reserve_id: uuidv4(),
      source: "balance_payout",
      amount: amountInCents,
      currency: "BRL",
      status: "completed",
      purpose,
      description,
      metadata: JSON.stringify(options.metadata || {}),
    });

    return {
      transactionId,
      entryId: entryIdReserve,
      newReserveBalance: newReserve,
      newAvailableBalance: newAvailable,
    };
  }
}

export const walletEngine = new WalletEngine();