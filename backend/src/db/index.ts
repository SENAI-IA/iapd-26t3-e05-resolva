import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000, max: 10 });
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}

export type AppDatabase = ReturnType<typeof createDatabase>;
