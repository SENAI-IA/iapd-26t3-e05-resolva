import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProjectConfig } from "../config/project.js";
import { readEnvironment } from "../config/environment.js";
import { createDatabase, type AppDatabase } from "./index.js";
import { seedExampleTickets } from "./seed.js";

let database: AppDatabase | undefined;
try {
  const environment = readEnvironment(process.env);
  if (!environment.DATABASE_URL) throw new Error();
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const configuredPath = resolve(root, environment.RESOLVA_CONFIG_PATH);
  const configPath = existsSync(configuredPath)
    ? configuredPath
    : resolve(root, "config/resolva.config.example.json");
  const config = parseProjectConfig(JSON.parse(readFileSync(configPath, "utf8")));
  database = createDatabase(environment.DATABASE_URL);
  const insertedCount = await seedExampleTickets(database, config);
  console.info(
    insertedCount > 0
      ? `${insertedCount} tickets de exemplo cadastrados.`
      : "Tickets de exemplo já estão cadastrados.",
  );
} catch {
  console.error(
    "Não foi possível cadastrar os tickets de exemplo. Verifique DATABASE_URL, a configuração e as migrações.",
  );
  process.exitCode = 1;
} finally {
  await database?.close();
}
