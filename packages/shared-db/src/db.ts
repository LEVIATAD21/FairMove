import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

let _db: any = null;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    _db = drizzle(new Pool({ connectionString: url }));
  }
  return _db;
}

export const db = new Proxy({} as any, {
  get(_target, prop) {
    if (typeof prop === "symbol") return undefined;
    if (prop === "then" || prop === "__esModule" || prop === "constructor") return undefined;
    const dbInstance = getDb();
    const val = dbInstance[prop];
    if (typeof val === "function") return val.bind(dbInstance);
    return val;
  },
});
