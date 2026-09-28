import { pgTable, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  discount_type: text("discount_type").notNull().default("fixed"),
  discount_value: integer("discount_value").notNull(),
  target_type: text("target_type").notNull().default("ride"),
  target_value: text("target_value"),
  max_uses: integer("max_uses"),
  uses_count: integer("uses_count").default(0).notNull(),
  start_date: timestamp("start_date"),
  end_date: timestamp("end_date"),
  is_active: boolean("is_active").default(true).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const coupons = pgTable("coupons", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: text("code").notNull().unique(),
  campaignId: text("campaign_id").references(() => campaigns.id),
  discount_value: integer("discount_value").default(0).notNull(),
  is_single_use: boolean("is_single_use").default(true).notNull(),
  is_active: boolean("is_active").default(true).notNull(),
  max_uses: integer("max_uses"),
  uses_count: integer("uses_count").default(0).notNull(),
  times_used: integer("times_used").default(0).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  expires_at: timestamp("expires_at"),
});

export const promotion_redemptions = pgTable(
  "promotion_redemptions",
  {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  rideId: text("ride_id"),
  couponId: text("coupon_id").references(() => coupons.id),
  passengerId: text("passenger_id"),
  redemption_code: text("redemption_code").notNull(),
  amount_discounted: integer("amount_discounted").notNull(),
  used_at: timestamp("used_at").defaultNow().notNull(),
  },
  (t) => ({
    // BUG-H2: releaseRedemptions/applyPromotion buscam por ride_id.
    rideIdx: index("idx_promotion_redemptions_ride").on(t.rideId),
  })
);

export type Campaign = typeof campaigns.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type PromotionRedemption = typeof promotion_redemptions.$inferSelect;
