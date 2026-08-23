import { Pool } from "pg";
export declare const db: import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>> & {
    $client: import("drizzle-orm/node-postgres").NodePgClient extends TClient ? Pool : TClient;
};
export type { User, Session, VerificationToken, OnboardingCompletion } from "./schema";
//# sourceMappingURL=index.d.ts.map