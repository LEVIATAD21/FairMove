import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { users, sessions, verificationTokens, onboardingCompletion } from "./schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool);

// Export types for use in other files
export type { User, Session, VerificationToken, OnboardingCompletion } from "./schema";