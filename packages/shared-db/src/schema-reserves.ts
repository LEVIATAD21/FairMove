import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const emergency_reserves = pgTable("emergency_reserves", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  driverId: text("driver_id").notNull().unique(),
  total_reserve: integer("total_reserve").default(0).notNull(),
  fuel_reserve: integer("fuel_reserve").default(0).notNull(),
  maintenance_reserve: integer("maintenance_reserve").default(0).notNull(),
  accident_reserve: integer("accident_reserve").default(0).notNull(),
  mechanical_reserve: integer("mechanical_reserve").default(0).notNull(),
  period_without_work_reserve: integer("period_without_work_reserve").default(0).notNull(),
  emergency_usage: integer("emergency_usage").default(0).notNull(),
  is_locked: boolean("is_locked").default(false).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const reserve_transactions = pgTable("reserve_transactions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  reserveId: text("reserve_id").notNull(),
  transactionId: text("transaction_id").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").default("BRL").notNull(),
  purpose: text("purpose").notNull(),
  direction: text("direction").notNull(),
  status: text("status").default("pending").notNull(),
  description: text("description"),
  metadata: text("metadata"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export type EmergencyReserve = typeof emergency_reserves.$inferSelect;
export type ReserveTransaction = typeof reserve_transactions.$inferSelect;
