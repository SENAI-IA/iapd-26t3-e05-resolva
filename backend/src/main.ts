import { createServer } from "./server.js";

const server = createServer();

async function shutdown() {
  try {
    await server.close();
  } catch {
    console.error("Não foi possível encerrar a API corretamente.");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await server.listen({ host: "127.0.0.1", port: 3000 });
  console.info("API do Resolva disponível em http://127.0.0.1:3000.");
} catch {
  console.error("Não foi possível iniciar a API local na porta 3000.");
  await shutdown();
  process.exitCode = 1;
}
