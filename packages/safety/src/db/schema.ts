import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const safety_events = pgTable("safety_events", {
  id: text("id").primaryKey().$defaultRandom(),
  rideId: text("ride_id").references(() => rides.id),
  eventType: text("event_type").notNull(), // "sos", "trusted_contact_alert", "trip_shared", "driver_code_verified", "incident_reported"
  title: text("title").notNull(),
  description: text("description"),
  severity: text("severity").default("low").notNull(), // "low", "medium", "high", "critical"
  status: text("status").default("open").notNull(), // "open", "resolved", "closed"
  reportedBy: text("reported_by").references(() => users.id),
  metadata: text("metadata", { mode: "json" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { mode: "nullable" }),
});

export const trust_contacts = pgTable("trust_contacts", {
  id: text("id").primaryKey().$defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id),
  contactName: text("contact_name").notNull(),
  contactPhone: text("contact_phone").notNull(),
  contactEmail: text("contact_email"),
  isPrimary: boolean("is_primary").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const trip_codes = pgTable("trip_codes", {
  id: text("id").primaryKey().$defaultRandom(),
  rideId: text("ride_id").notNull().references(() => rides.id),
  code: text("code").notNull(),
  isVerified: boolean("is_verified").default(false).notNull(),
  usedByPassenger: boolean("used_by_passenger").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  usedAt: timestamp("used_at", { mode: "nullable" }),
});

export const incidents = pgTable("incidents", {
  id: text("id").primaryKey().$defaultRandom(),
  rideId: text("ride_id").references(() => rides.id),
  type: text("type").notNull(), // "accident", "incident", "crime", "health"
  severity: text("severity").notNull(), // "low", "medium", "high", "critical"
  description: text("description").notNull(),
  status: text("status").default("open").notNull(), // "open", "investigating", "resolved", "closed"
  reportedBy: text("reported_by").references(() => users.id),
  resolvedBy: text("resolved_by", { mode: "nullable" }).references(() => users.id),
  resolvedAt: timestamp("resolved_at", { mode: "nullable" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAtActual: timestamp("resolved_at_actual", { mode: "nullable" }),
});

export type SafetyEvent = typeof safety_events.$inferSelect;
export type TrustContact = typeof trust_contacts.$inferSelect;
export type TripCode = typeof trip_codes.$inferSelect;
export type Incident = typeof incidents.$inferSelect;

// Reference tables - need to be imported from other packages
export const rides = pgTable("rides", {
  id: text("id").primaryKey().$defaultRandom(),
  passengerId: text("passenger_id").notNull(),
  driverId: text("driver_id").references(() => drivers.id),
  vehicleId: text("vehicle_id").references(() => vehicles.id),
  status: text("status").default("REQUESTED").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("passenger"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});