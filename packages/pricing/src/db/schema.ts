import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";

export const pricing_quotes = pgTable("pricing_quotes", {
  id: text("id").primaryKey().$defaultRandom(),
  base_fare: integer("base_fare").default(0).notNull(),
  distance_fare_per_km: integer("distance_fare_per_km").default(0).notNull(),
  time_fare_per_minute: integer("time_fare_per_minute").default(0).notNull(),
  dynamic_adjustment: integer("dynamic_adjustment").default(0).notNull(),
  promotion_discount: integer("promotion_discount").default(0).notNull(),
  original_price: integer("original_price").notNull(),
  final_passenger_price: integer("final_passenger_price").notNull(),
  driver_credit: integer("driver_credit").notNull(),
  currency: text("currency").default("BRL").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type PricingQuote = typeof pricing_quotes.$inferSelect;