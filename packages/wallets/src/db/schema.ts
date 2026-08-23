import { pgTable, text, integer, boolean, timestamp, numeric } from "drizzle-orm/pg-core";

export const wallets = pgTable("wallets", {
  id: text("id").primaryKey().$defaultRandom(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  available_balance: numeric("available_balance").default("0").notNull(),
  pending_balance: numeric("pending_balance").default("0").notNull(),
  reserve_balance: numeric("reserve_balance").default("0").notNull(),
  currency: text("currency").default("BRL").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const wallet_accounts = pgTable("wallet_accounts", {
  id: text("id").primaryKey().$defaultRandom(),
  walletId: text("wallet_id").notNull().references(() => wallets.id),
  account_type: text("account_type").notNull(), // "available", "pending", "reserve"
  balance: numeric("balance").default("0").notNull(),
  currency: text("currency").default("BRL").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const ledger_transactions = pgTable("ledger_transactions", {
  id: text("id").primaryKey().$defaultRandom(),
  transaction_id: text("transaction_id").notNull().unique(),
  source_account: text("source_account").notNull(), // "wallet", "reserve", "payment_provider"
  destination_account: text("destination_account").notNull(),
  amount: numeric("amount").notNull(),
  currency: text("currency").default("BRL").notNull(),
  direction: text("direction").notNull(), // "debit" or "credit"
  status: text("status").default("pending").notNull(), // "pending", "completed", "failed", "refunded"
  description: text("description"),
  metadata: text("metadata", { mode: "json" }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const ledger_entries = pgTable("ledger_entries", {
  id: text("id").primaryKey().$defaultRandom(),
  entry_id: text("entry_id").notNull().unique(),
  transaction_id: text("transaction_id").references(() => ledger_transactions.id),
  account_id: text("account_id").notNull(),
  amount: numeric("amount").notNull(),
  balance_after: numeric("balance_after").notNull(),
  entry_type: text("entry_type").notNull(), // "credit" or "debit"
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const reserve_transactions = pgTable("reserve_transactions", {
  id: text("id").primaryKey().$defaultRandom(),
  reserve_id: text("reserve_id").notNull().unique(),
  source: text("source").notNull(), // "ride_payment", "refund", "adjustment"
  amount: numeric("amount").notNull(),
  currency: text("currency").default("BRL").notNull(),
  status: text("status").default("pending").notNull(),
  purpose: text("purpose"), // "fuel", "maintenance", "accident", "mechanical", "period_without_work", "emergency"
  description: text("description"),
  metadata: text("metadata", { mode: "json" }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export type Wallet = typeof wallets.$inferSelect;
export type WalletAccount = typeof wallet_accounts.$inferSelect;
export type LedgerTransaction = typeof ledger_transactions.$inferSelect;
export type LedgerEntry = typeof ledger_entries.$inferSelect;
export type ReserveTransaction = typeof reserve_transactions.$inferSelect;