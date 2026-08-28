import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().unique(),
  status: text("status").notNull().default("free"),
  plan: text("plan").notNull().default("free"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAt: boolean("cancel_at").default(false).notNull(),
  canceledAt: timestamp("canceled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
