import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvironment } from "./config/environment.js";
import { parseProjectConfig } from "./config/project.js";
import { createDatabase, type AppDatabase } from "./db/index.js";
import { defaultCategories } from "./domain/contracts.js";
import { createTicketRepository } from "./repository/ticketRepository.js";
import { createTriageRepository } from "./repository/triageRepository.js";
import { createImplementationRepository } from "./repository/implementationRepository.js";
import { createGithubClient } from "./integrations/github/cli.js";
import { createServer } from "./server.js";
import { createKiroTriageRunner } from "./integrations/kiro/triageRunner.js";
import { createTicketService } from "./services/ticketService.js";
import { createTriageService } from "./services/triageService.js";
import { createImplementationService } from "./services/implementationService.js";
import { createPipelineReportCollector } from "./integrations/ci/collectReport.js";

let server: ReturnType<typeof createServer> | undefined;
let database: AppDatabase | undefined;
let shutdownPromise: Promise<void> | undefined;

function shutdown() {
  shutdownPromise ??= (async () => {
    try {
      await server?.close();
    } finally {
      await database?.close();
    }
  })().catch(() => {
    console.error("Não foi possível encerrar a API corretamente.");
    process.exitCode = 1;
  });
  return shutdownPromise;
}

function findKiroExecutable() {
  try {
    const executable = execFileSync("which", ["kiro-cli"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return executable || undefined;
  } catch {
    return undefined;
  }
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  const environment = readEnvironment(process.env);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const configPath = resolve(root, environment.RESOLVA_CONFIG_PATH);
  let categories = defaultCategories.map((category) => category.slug);
  let targetConfig: ReturnType<typeof parseProjectConfig> | undefined;
  if (existsSync(configPath)) {
    try {
      targetConfig = parseProjectConfig(JSON.parse(readFileSync(configPath, "utf8")));
      categories = targetConfig.categories.map((category) => category.slug);
    } catch {
      console.warn(
        "Configuração do projeto-alvo inválida. O cadastro de tickets ficará bloqueado.",
      );
    }
  }
  const kiroExecutable =
    targetConfig && environment.KIRO_API_KEY ? findKiroExecutable() : undefined;
  const triageRunner =
    targetConfig && environment.KIRO_API_KEY && kiroExecutable
      ? createKiroTriageRunner({
          applicationRoot: root,
          executable: kiroExecutable,
          model: targetConfig.kiroModel,
          apiKey: environment.KIRO_API_KEY,
          secretValues: [environment.GH_TOKEN, environment.DATABASE_URL].filter(
            (value): value is string => Boolean(value),
          ),
          timeoutSeconds: targetConfig.kiroTimeoutSeconds,
        })
      : undefined;
  if (environment.DATABASE_URL) {
    database = createDatabase(environment.DATABASE_URL);
    database.pool.on("error", () =>
      console.error("A conexão com o banco de dados ficou indisponível."),
    );
  }
  server = createServer(
    database
      ? {
          ticketService: createTicketService(
            createTicketRepository(database),
            categories,
            targetConfig,
          ),
          triageService: createTriageService(createTriageRepository(database), triageRunner),
          implementationService: createImplementationService(
            createImplementationRepository(database),
            { ready: false, sourceHashes: {} },
            createGithubClient(environment.GH_TOKEN ? { token: environment.GH_TOKEN } : {}),
            createPipelineReportCollector({
              applicationRoot: root,
              secretValues: [
                environment.GH_TOKEN,
                environment.KIRO_API_KEY,
                environment.DATABASE_URL,
              ].filter((value): value is string => Boolean(value)),
            }),
          ),
        }
      : {},
  );
  await server.listen({ host: "127.0.0.1", port: 3000 });
  console.info("API do Resolva disponível em http://127.0.0.1:3000.");
} catch {
  console.error("Não foi possível iniciar a API local. Verifique a configuração e a porta 3000.");
  await shutdown();
  process.exitCode = 1;
}
