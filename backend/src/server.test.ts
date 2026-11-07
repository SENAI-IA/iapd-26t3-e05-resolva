import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";

const servers: ReturnType<typeof createServer>[] = [];

function setup() {
  const server = createServer();
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("API local", () => {
  it("sanitiza erros de URL antes do roteamento", async () => {
    const response = await setup().inject({
      method: "GET",
      url: "/segredo-ficticio/%ZZ",
      headers: { host: "localhost:3000" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "BAD_REQUEST", message: "Solicitação inválida." });
  });

  it("recusa acesso externo mesmo com URL inválida", async () => {
    const response = await setup().inject({
      method: "GET",
      url: "/segredo-ficticio/%ZZ",
      headers: { host: "evil.example:3000", origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: "FORBIDDEN",
      message: "Acesso permitido somente pelo ambiente local.",
    });
  });

  it("informa a disponibilidade da API sem exigir banco ou IA", async () => {
    const response = await setup().inject({
      method: "GET",
      url: "/rest/health",
      headers: { host: "127.0.0.1:3000" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it.each(["http://127.0.0.1:5173", "http://localhost:5173"])(
    "aceita o navegador local em %s",
    async (origin) => {
      const response = await setup().inject({
        method: "GET",
        url: "/rest/health",
        headers: { host: "localhost:3000", origin },
      });
      expect(response.statusCode).toBe(200);
    },
  );

  it("aceita o Host encaminhado pelo proxy do Vite", async () => {
    const response = await setup().inject({
      method: "GET",
      url: "/rest/health",
      headers: { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" },
    });
    expect(response.statusCode).toBe(200);
  });

  it.each(["evil.example:3000", "127.0.0.1.evil.example:3000", "localhost:9000"])(
    "recusa Host não autorizado: %s",
    async (host) => {
      const response = await setup().inject({
        method: "GET",
        url: "/rest/health",
        headers: { host, "x-forwarded-host": "localhost:3000" },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        code: "FORBIDDEN",
        message: "Acesso permitido somente pelo ambiente local.",
      });
    },
  );

  it.each([
    "null",
    "https://evil.example",
    "http://localhost:5173.evil.example",
    "http://localhost:9000",
  ])("recusa Origin não autorizada: %s", async (origin) => {
    const response = await setup().inject({
      method: "GET",
      url: "/rest/health",
      headers: { host: "localhost:3000", origin },
    });
    expect(response.statusCode).toBe(403);
  });

  it("responde rotas inexistentes sem refletir o caminho recebido", async () => {
    const response = await setup().inject({
      method: "GET",
      url: "/segredo-ficticio",
      headers: { host: "localhost:3000" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "NOT_FOUND", message: "Rota não encontrada." });
  });

  it("omite detalhes internos em falhas de processamento", async () => {
    const server = setup();
    server.get("/falha", async () => {
      throw new Error("credencial-ficticia-interna");
    });
    const response = await server.inject({
      method: "GET",
      url: "/falha",
      headers: { host: "localhost:3000" },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível concluir a solicitação.",
    });
  });

  it("trata JSON malformado como erro público de entrada", async () => {
    const server = setup();
    server.post("/entrada", async () => ({ status: "ok" }));
    const response = await server.inject({
      method: "POST",
      url: "/entrada",
      headers: { host: "localhost:3000", "content-type": "application/json" },
      payload: '{"segredo-ficticio":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "BAD_REQUEST", message: "Solicitação inválida." });
  });
});
