import { readEnvironment } from "../config/environment.js";
import { createDatabase, type AppDatabase } from "./index.js";
import { migrateDatabase } from "./migrate.js";

let database: AppDatabase | undefined;
try {
  const environment = readEnvironment(process.env);
  if (!environment.DATABASE_URL) throw new Error();
  database = createDatabase(environment.DATABASE_URL);
  await migrateDatabase(database);
  console.info("Migrações aplicadas com sucesso.");
} catch {
  console.error(
    "Não foi possível aplicar as migrações. Verifique DATABASE_URL e a disponibilidade do banco.",
  );
  process.exitCode = 1;
} finally {
  await database?.close();
}
