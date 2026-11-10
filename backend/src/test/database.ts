import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createDatabase } from "../db/index.js";
import { migrateDatabase } from "../db/migrate.js";

export async function startTestDatabase() {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const database = createDatabase(container.getConnectionUri());
  try {
    await migrateDatabase(database);
  } catch (error) {
    await database.close();
    await container.stop();
    throw error;
  }
  return {
    database,
    async stop() {
      try {
        await database.close();
      } finally {
        await container.stop();
      }
    },
  };
}
