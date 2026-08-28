import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const safety_events = pgTable("safety_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  rideId: text("ride_id"),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  severity: text("severity").default("low").notNull(),
  status: text("status").default("open").notNull(),
  reportedBy: text("reported_by"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const trust_contacts = pgTable("trust_contacts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  contactName: text("contact_name").notNull(),
  contactPhone: text("contact_phone").notNull(),
  contactEmail: text("contact_email"),
  isPrimary: boolean("is_primary").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const trip_codes = pgTable("trip_codes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  rideId: text("ride_id").notNull(),
  code: text("code").notNull(),
  isVerified: boolean("is_verified").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  usedAt: timestamp("used_at"),
});

export const incidents = pgTable("incidents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  rideId: text("ride_id"),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  status: text("status").default("open").notNull(),
  reportedBy: text("reported_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export type SafetyEvent = typeof safety_events.$inferSelect;
export type TrustContact = typeof trust_contacts.$inferSelect;
export type TripCode = typeof trip_codes.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
