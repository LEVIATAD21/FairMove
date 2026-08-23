import { pgTable, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["passenger", "driver"]);

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

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey().$defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "nullable" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  id: text("id").primaryKey().$defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "nullable" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const onboardingCompletion = pgTable("onboarding_completion", {
  id: text("id").primaryKey().$defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id),
  step: text("step").notNull(),
  completed: boolean("completed").default(false).notNull(),
  completedAt: timestamp("completed_at", { mode: "nullable" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type VerificationToken = typeof verificationTokens.$inferSelect;
export type OnboardingCompletion = typeof onboardingCompletion.$inferInsert;