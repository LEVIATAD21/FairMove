import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey().$defaultRandom(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  status: text("status").notNull().default("free"), // "free", "active", "expired", "cancelled"
  plan: text("plan").notNull().default("free"), // "free", "pro"
  startedAt: timestamp("started_at").defaultNow().notNull(),
  trialEndsAt: timestamp("trial_ends_at", { mode: "nullable" }),
  priceId: text("price_id", { mode: "nullable" }),
  currentPeriodStart: timestamp("current_period_start", { mode: "nullable" }),
  currentPeriodEnd: timestamp("current_period_end", { mode: "nullable" }),
  cancelAt: boolean("cancel_at").default(false).notNull(),
  canceledAt: timestamp("canceled_at", { mode: "nullable" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;