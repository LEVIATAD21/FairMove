import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/** Comandos que realmente precisam de conexão com o banco. */
const DB_COMMANDS = ["push", "migrate", "studio", "pull", "check"];
const needsDatabase = process.argv.some((arg) => DB_COMMANDS.includes(arg));

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (needsDatabase) {
    throw new Error("DATABASE_URL is required for this drizzle-kit command");
  }
  // Comandos offline (generate) não acessam o banco.
  return "postgres://offline:offline@localhost:5432/offline";
}

export default defineConfig({
  schema: "./packages/shared-db/src/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
  verbose: true,
  strict: false,
});
