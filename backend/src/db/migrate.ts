import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { AppDatabase } from "./index.js";

export async function migrateDatabase(database: AppDatabase): Promise<void> {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
}
