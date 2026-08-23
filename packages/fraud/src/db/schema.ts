import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const fraud_events = pgTable("fraud_events", {
  id: text("id").primaryKey().$defaultRandom(),
  userId: text("user_id").references(() => users.id),
  rideId: text("ride_id").references(() => rides.id),
  eventType: text("event_type").notNull(), // "device_risk", "account_risk", "payment_risk", "ride_risk", "behavioral_risk"
  riskLevel: text("risk_level").notNull(), // "LOW", "MEDIUM", "HIGH", "CRITICAL"
  score: integer("score"), // 0-100
  description: text("description"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const risk_scores = pgTable("risk_scores", {
  id: text("id").primaryKey().$defaultRandom(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  overallScore: integer("overall_score"), // 0-100
  riskLevel: text("risk_level").notNull(), // "LOW", "MEDIUM", "HIGH", "CRITICAL"
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow().notNull(),
  calculationDetails: text("calculation_details", { mode: "json" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FraudEvent = typeof fraud_events.$inferSelect;
export type RiskScore = typeof risk_scores.$inferSelect;