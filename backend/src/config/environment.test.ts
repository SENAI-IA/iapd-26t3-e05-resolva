import { describe, expect, it } from "vitest";
import { readEnvironment } from "./environment.js";

describe("ambiente", () => {
  it("permite ambiente incompleto sem impedir a API local", () => {
    expect(readEnvironment({})).toEqual({ RESOLVA_CONFIG_PATH: "resolva.config.json" });
  });
  it("seleciona somente variáveis necessárias e preserva os segredos no backend", () => {
    expect(
      readEnvironment({
        DATABASE_URL: "postgresql://local:senha@127.0.0.1:5433/resolva",
        GH_TOKEN: "token-ficticio",
        PATH: "/bin",
        KIRO_API_KEY: "chave-ficticia",
      }),
    ).toEqual({
      DATABASE_URL: "postgresql://local:senha@127.0.0.1:5433/resolva",
      GH_TOKEN: "token-ficticio",
      KIRO_API_KEY: "chave-ficticia",
      RESOLVA_CONFIG_PATH: "resolva.config.json",
    });
  });
  it.each([
    "https://senha-ficticia@exemplo.test/db",
    "postgres://local:senha-ficticia@",
    "senha-ficticia",
  ])("recusa URL de banco inválida sem incluir o segredo no erro", (DATABASE_URL) => {
    expect(() => readEnvironment({ DATABASE_URL })).toThrow("Configuração de ambiente inválida.");
  });
  it("trata valores vazios como configuração ausente", () => {
    expect(
      readEnvironment({
        DATABASE_URL: "",
        GH_TOKEN: "",
        KIRO_API_KEY: "",
        RESOLVA_CONFIG_PATH: "",
      }),
    ).toEqual({ RESOLVA_CONFIG_PATH: "resolva.config.json" });
  });
});
