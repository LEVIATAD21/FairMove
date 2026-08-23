"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onboardingCompletion = exports.verificationTokens = exports.sessions = exports.users = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
exports.users = (0, pg_core_1.pgTable)("users", {
    id: (0, pg_core_1.text)("id").primaryKey().defaultRandom(),
    name: (0, pg_core_1.text)("name").notNull(),
    email: (0, pg_core_1.text)("email").notNull().unique(),
    passwordHash: (0, pg_core_1.text)("password_hash").notNull(),
    role: (0, pg_core_1.text)("role").notNull().default("passenger"),
    emailVerified: (0, pg_core_1.timestamp)("email_verified", { mode: "nullable" }),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
});
exports.sessions = (0, pg_core_1.pgTable)("sessions", {
    id: (0, pg_core_1.text)("id").primaryKey().defaultRandom(),
    userId: (0, pg_core_1.text)("user_id").notNull().references(() => exports.users.id),
    token: (0, pg_core_1.text)("token").notNull().unique(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at", { mode: "nullable" }).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
});
exports.verificationTokens = (0, pg_core_1.pgTable)("verification_tokens", {
    id: (0, pg_core_1.text)("id").primaryKey().defaultRandom(),
    userId: (0, pg_core_1.text)("user_id").notNull().references(() => exports.users.id),
    token: (0, pg_core_1.text)("token").notNull().unique(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at", { mode: "nullable" }).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
});
exports.onboardingCompletion = (0, pg_core_1.pgTable)("onboarding_completion", {
    id: (0, pg_core_1.text)("id").primaryKey().defaultRandom(),
    userId: (0, pg_core_1.text)("user_id").notNull().references(() => exports.users.id),
    step: (0, pg_core_1.text)("step").notNull(),
    completed: boolean("completed").default(false).notNull(),
    completedAt: (0, pg_core_1.timestamp)("completed_at", { mode: "nullable" }),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow().notNull(),
});
//# sourceMappingURL=schema.js.map