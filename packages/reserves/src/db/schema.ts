import { pgTable, text, integer, boolean, timestamp, numeric } from "drizzle-orm/pg-core";

export const emergency_reserves = pgTable("emergency_reserves", {
  id: text("id").primaryKey().$defaultRandom(),
  driverId: text("driver_id").notNull().unique().references(() => drivers.id),
  total_reserve: numeric("total_reserve").default("0").notNull(),
  fuel_reserve: numeric("fuel_reserve").default("0").notNull(),
  maintenance_reserve: numeric("maintenance_reserve").default("0").notNull(),
  accident_reserve: numeric("accident_reserve").default("0").notNull(),
  mechanical_reserve: numeric("mechanical_reserve").default("0").notNull(),
  period_without_work_reserve: numeric("period_without_work_reserve").default("0").notNull(),
  emergency_usage: numeric("emergency_usage").default("0").notNull,
  is_locked: boolean("is_locked").default(false).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const reserve_transactions = pgTable("reserve_transactions", {
  id: text("id").primaryKey().$defaultRandom(),
  reserveId: text("reserve_id").notNull().references(() => emergency_reserves.id),
  transactionId: text("transaction_id").notNull(),
  amount: numeric("amount").notNull(),
  currency: text("currency").default("BRL").notNull(),
  purpose: text("purpose").notNull(), // fuel, maintenance, accident, mechanical, period_without_work, emergency
  direction: text("direction").notNull(), // "contribution" or "payout"
  status: text("status").default("pending").notNull(), // pending, completed, failed
  description: text("description"),
  metadata: text("metadata", { mode: "json" }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export type EmergencyReserve = typeof emergency_reserves.$inferSelect;
export type ReserveTransaction = typeof reserve_transactions.$inferSelect;