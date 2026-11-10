import type { IncomingHttpHeaders } from "node:http";
import Fastify, { type FastifyReply } from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./trpc/router.js";
import type { TicketService } from "./services/ticketService.js";
import type { TriageService } from "./services/triageService.js";

export function createServer(
  options: { ticketService?: TicketService; triageService?: TriageService } = {},
) {
  const allowedHosts = new Set([
    "127.0.0.1:3000",
    "localhost:3000",
    "127.0.0.1:5173",
    "localhost:5173",
  ]);
  const allowedOrigins = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
  const forbiddenResponse = {
    code: "FORBIDDEN",
    message: "Acesso permitido somente pelo ambiente local.",
  };

  function isLocalRequest(headers: IncomingHttpHeaders) {
    const host = headers.host?.toLowerCase();
    return (
      host !== undefined &&
      allowedHosts.has(host) &&
      (headers.origin === undefined || allowedOrigins.has(headers.origin))
    );
  }

  const server = Fastify({
    logger: false,
    trustProxy: false,
    frameworkErrors: (_error, request, reply: FastifyReply) => {
      if (!isLocalRequest(request.headers)) {
        return reply.code(403).send(forbiddenResponse);
      }
      return reply.code(400).send({ code: "BAD_REQUEST", message: "Solicitação inválida." });
    },
  });

  server.addHook("onRequest", async (request, reply) => {
    if (!isLocalRequest(request.headers)) {
      return reply.code(403).send(forbiddenResponse);
    }
  });

  server.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ code: "NOT_FOUND", message: "Rota não encontrada." });
  });

  server.setErrorHandler((error, _request, reply) => {
    const statusCode =
      error instanceof Error && "statusCode" in error ? error.statusCode : undefined;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ code: "BAD_REQUEST", message: "Solicitação inválida." });
    }
    return reply.code(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível concluir a solicitação.",
    });
  });

  server.get("/rest/health", async () => ({ status: "ok" as const }));
  server.addHook("onClose", async () => options.triageService?.drain());
  server.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext: () => ({
        tickets: options.ticketService ?? null,
        triages: options.triageService ?? null,
      }),
    },
  });
  return server;
}
