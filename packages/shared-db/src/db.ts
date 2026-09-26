import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

function buildDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return drizzle(new Pool({ connectionString: url }));
}

/** Tipo do executor Drizzle (o mesmo tipo aceito por `db.transaction`). */
export type Database = ReturnType<typeof buildDb>;

/** Tipo do callback/transação de `db.transaction(...)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Qualquer executor de consulta: o próprio `db` ou uma transação (`tx`).
 * Use nos engines para que operações possam participar de transações.
 */
export type Executor = Database | Transaction;

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    _db = buildDb();
  }
  return _db;
}

/**
 * Acesso preguiçoso ao banco: a conexão só é criada na primeira consulta e o
 * erro "DATABASE_URL not set" é lançado com mensagem clara.
 */
export const db = new Proxy({} as Database, {
  get(_target, prop) {
    if (typeof prop === "symbol") return undefined;
    if (prop === "then" || prop === "__esModule" || prop === "constructor") return undefined;
    const dbInstance = getDb() as unknown as Record<string | symbol, unknown>;
    const val = dbInstance[prop];
    if (typeof val === "function") return (val as (...args: unknown[]) => unknown).bind(dbInstance);
    return val;
  },
});
