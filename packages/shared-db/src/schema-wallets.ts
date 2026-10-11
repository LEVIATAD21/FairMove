import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./schema-auth";

export const wallets = pgTable("wallets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().unique(),
  available_balance: integer("available_balance").default(0).notNull(),
  pending_balance: integer("pending_balance").default(0).notNull(),
  reserve_balance: integer("reserve_balance").default(0).notNull(),
  currency: text("currency").default("BRL").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const wallet_accounts = pgTable("wallet_accounts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  walletId: text("wallet_id").notNull().references(() => wallets.id),
  accountType: text("account_type").notNull(),
  balance: integer("balance").default(0).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const ledger_transactions = pgTable(
  "ledger_transactions",
  {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  walletId: text("wallet_id").notNull().references(() => wallets.id),
  transactionType: text("transaction_type").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").default("BRL").notNull(),
  description: text("description"),
  metadata: text("metadata"),
  status: text("status").default("completed").notNull(),
  idempotencyKey: text("idempotency_key").unique(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    walletCreatedIdx: index("idx_ledger_tx_wallet_created").on(t.walletId, t.created_at),
  })
);

export const ledger_entries = pgTable(
  "ledger_entries",
  {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  transactionId: text("transaction_id").notNull().references(() => ledger_transactions.id),
  walletId: text("wallet_id").notNull().references(() => wallets.id),
  entryType: text("entry_type").notNull(),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    walletCreatedIdx: index("idx_ledger_entries_wallet_created").on(t.walletId, t.created_at),
  })
);

export const walletDeposits = pgTable(
  "wallet_deposits",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").default("BRL").notNull(),
    provider: text("provider").default("mercadopago").notNull(),
    status: text("status").default("pending").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique("wallet_deposits_idempotency_key_unique"),
    providerPaymentId: text("provider_payment_id").unique("wallet_deposits_provider_payment_id_unique"),
    qrCode: text("qr_code"),
    qrCodeBase64: text("qr_code_base64"),
    ticketUrl: text("ticket_url"),
    expiresAt: timestamp("expires_at"),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index("idx_wallet_deposits_user_created").on(t.userId, t.createdAt),
    statusCreatedIdx: index("idx_wallet_deposits_status_created").on(t.status, t.createdAt),
  })
);

export type Wallet = typeof wallets.$inferSelect;
export type WalletAccount = typeof wallet_accounts.$inferSelect;
export type LedgerTransaction = typeof ledger_transactions.$inferSelect;
export type LedgerEntry = typeof ledger_entries.$inferSelect;
export type WalletDeposit = typeof walletDeposits.$inferSelect;
