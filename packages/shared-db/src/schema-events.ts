import { pgTable, text, integer, timestamp, boolean, pgEnum, numeric } from "drizzle-orm/pg-core";

export const eventStatusEnum = pgEnum("event_status", [
  "draft",
  "open",
  "running",
  "closed",
  "cancelled",
]);

export const rewardTierEnum = pgEnum("reward_tier", [
  "tier_5_10",
  "tier_4",
  "tier_3",
  "tier_2",
  "tier_1",
]);

export const events = pgTable("events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  buyInFee: integer("buy_in_fee").notNull().default(2000), // centavos
  status: eventStatusEnum("status").notNull().default("draft"),
  maxParticipants: integer("max_participants"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const eventParticipants = pgTable("event_participants", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventId: text("event_id").notNull().references(() => events.id),
  driverId: text("driver_id").notNull(),
  enrolledAt: timestamp("enrolled_at").defaultNow().notNull(),
  paymentStatus: text("payment_status").notNull().default("pending"), // pending, paid, refunded, failed
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const eventLeaderboard = pgTable("event_leaderboard", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventId: text("event_id").notNull().references(() => events.id),
  driverId: text("driver_id").notNull(),
  rank: integer("rank").notNull(),
  score: numeric("score", { precision: 12, scale: 4 }).notNull(),
  rewardTier: rewardTierEnum("reward_tier"),
  ridesCount: integer("rides_count").default(0).notNull(),
  avgRating: numeric("avg_rating", { precision: 3, scale: 2 }).default("0").notNull(),
  acceptanceRate: numeric("acceptance_rate", { precision: 5, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const rewardWalletTransactions = pgTable("reward_wallet_transactions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  driverId: text("driver_id").notNull(),
  eventId: text("event_id").references(() => events.id),
  type: text("type").notNull(), // credit, debit, redeem
  amount: integer("amount").notNull(), // centavos
  currency: text("currency").default("BRL").notNull(),
  description: text("description"),
  status: text("status").notNull().default("completed"), // completed, pending, failed, reversed
  metadata: text("metadata"), // JSON
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cinemaRewardClaims = pgTable("cinema_reward_claims", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  driverId: text("driver_id").notNull(),
  eventId: text("event_id").notNull().references(() => events.id),
  cinemaLink: text("cinema_link").notNull(),
  pixKey: text("pix_key"),
  amount: integer("amount").notNull(), // centavos
  status: text("status").notNull().default("pending_approval"), // pending_approval, approved, rejected, redeemed, cancelled
  adminNotes: text("admin_notes"),
  approvedAt: timestamp("approved_at"),
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Recompensas distribuídas do FairMove League.
 *
 * Uma linha por recompensa emitida para um motorista:
 * - `cash_prize` — valor em centavos creditado em `wallet_balance` (saque livre).
 * - `discount_coupon` — percentual (`discount_percent`) sobre a FATIA DA
 *   PLATAFORMA da mensalidade por `duration_months`; nunca toca a reserva.
 * - `cinema_voucher` — ingresso do Cinema FairMove (value = 0).
 */
export const eventRewards = pgTable("event_rewards", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventId: text("event_id").notNull().references(() => events.id),
  driverId: text("driver_id").notNull(),
  rank: integer("rank").notNull(),
  rewardType: text("reward_type").notNull(), // cash_prize, discount_coupon, cinema_voucher
  /** Centavos: valor em dinheiro do prêmio (0 para cupons/vouchers). */
  rewardValueCents: integer("reward_value_cents").notNull().default(0),
  /** Percentual do cupom de desconto (0–100), apenas para `discount_coupon`. */
  discountPercent: integer("discount_percent"),
  /** Vigência do cupom em meses (apenas `discount_coupon`). */
  durationMonths: integer("duration_months"),
  status: text("status").notNull().default("pending"), // pending, credited, expired, cancelled
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Event = typeof events.$inferSelect;
export type EventParticipant = typeof eventParticipants.$inferSelect;
export type EventLeaderboard = typeof eventLeaderboard.$inferSelect;
export type RewardWalletTransaction = typeof rewardWalletTransactions.$inferSelect;
export type CinemaRewardClaim = typeof cinemaRewardClaims.$inferSelect;
export type EventReward = typeof eventRewards.$inferSelect;