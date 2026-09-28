import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const fraud_events = pgTable(
  "fraud_events",
  {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id"),
  rideId: text("ride_id"),
  eventType: text("event_type").notNull(),
  riskLevel: text("risk_level").notNull(),
  score: integer("score"),
  description: text("description"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // BUG-H2: scoring roda 3 queries (user_id, event_type) por avaliação.
    userTypeIdx: index("idx_fraud_events_user_type").on(t.userId, t.eventType),
  })
);

export const risk_scores = pgTable("risk_scores", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().unique(),
  overallScore: integer("overall_score"),
  riskLevel: text("risk_level").notNull(),
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow().notNull(),
  calculationDetails: text("calculation_details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FraudEvent = typeof fraud_events.$inferSelect;
export type RiskScore = typeof risk_scores.$inferSelect;
