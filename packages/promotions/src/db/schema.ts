import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey().$defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  discount_type: text("discount_type").notNull().default("fixed"), // "percent" or "fixed"
  discount_value: integer("discount_value").notNull(), // percentage (1-100) or fixed amount in cents
  target_type: text("target_type").notNull().default("ride"), // "ride", "user", "region", "category"
  target_value: text("target_value"), // e.g., "first_ride", "region_sao_paulo", "motorcycle"
  max_uses: integer("max_uses"), // -1 for unlimited
  uses_count: integer("uses_count").default(0).notNull(),
  start_date: timestamp("start_date"),
  end_date: timestamp("end_date"),
  is_active: boolean("is_active").default(true).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const coupons = pgTable("coupons", {
  id: text("id").primaryKey().$defaultRandom(),
  code: text("code").notNull().unique(),
  campaignId: text("campaign_id").references(() => campaigns.id),
  is_single_use: boolean("is_single_use").default(true).notNull(),
  times_used: integer("times_used").default(0).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  expires_at: timestamp("expires_at", { mode: "nullable" }),
});

export const promotion_redemptions = pgTable("promotion_redemptions", {
  id: text("id").primaryKey().$defaultRandom(),
  rideId: text("ride_id").references(() => rides.id),
  couponId: text("coupon_id").references(() => coupons.id),
  passengerId: text("passenger_id").references(() => users.id),
  redemption_code: text("redemption_code").notNull(),
  amount_discounted: integer("amount_discounted").notNull(),
  used_at: timestamp("used_at").defaultNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type PromotionRedemption = typeof promotion_redemptions.$inferSelect;

// For the rides schema, we need to reference it
export const rides = pgTable("rides", {
  id: text("id").primaryKey().$defaultRandom(),
  passengerId: text("passenger_id").notNull(),
  driverId: text("driver_id").references(() => drivers.id),
  vehicleId: text("vehicle_id").references(() => vehicles.id),
  pickupLocationLat: text("pickup_location_lat"),
  pickupLocationLng: text("pickup_location_lng"),
  dropoffLocationLat: text("dropoff_location_lat"),
  dropoffLocationLng: text("dropoff_location_lng"),
  status: text("status").default("REQUESTED").notNull(),
  baseFare: integer("base_fare").default(0).notNull(),
  distanceFare: integer("distance_fare").default(0).notNull(),
  timeFare: integer("time_fare").default(0).notNull(),
  promotionDiscount: integer("promotion_discount").default(0).notNull(),
  finalPassengerPrice: integer("final_passenger_price").notNull(),
  driverCredit: integer("driver_credit").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type { Ride } from "../rides/src/db/schema";