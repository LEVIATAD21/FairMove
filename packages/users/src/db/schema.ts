import { pgTable, text, timestamp, boolean, pgEnum, integer } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["passenger", "driver"]);

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey().$defaultRandom(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  phone: text("phone"),
  documentNumber: text("document_number"),
  documentType: text("document_type"),
  documentUrl: text("document_url"),
  isVerified: boolean("is_verified").default(false).notNull(),
  rating: integer("rating").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const drivers = pgTable("drivers", {
  id: text("id").primaryKey().$defaultRandom(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  vehicleId: text("vehicle_id").references(() => vehicles.id),
  status: text("status").default("offline").notNull(),
  available: boolean("available").default(true).notNull(),
  currentLocationLat: text("current_location_lat"),
  currentLocationLng: text("current_location_lng"),
  earnedToday: integer("earned_today").default(0).notNull(),
  pendingBalance: integer("pending_balance").default(0).notNull(),
  reserveBalance: integer("reserve_balance").default(0).notNull(),
  subscriptionStatus: text("subscription_status").default("free").notNull(),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { mode: "nullable" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const vehicles = pgTable("vehicles", {
  id: text("id").primaryKey().$defaultRandom(),
  driverId: text("driver_id").references(() => drivers.id),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  color: text("color"),
  plate: text("plate").notNull().unique(),
  vehicleType: text("vehicle_type").notNull().default("car"), // car or motorcycle
  category: text("category"),
  status: text("status").default("available").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("passenger"),
  emailVerified: timestamp("email_verified", { mode: "nullable" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Driver = typeof drivers.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;