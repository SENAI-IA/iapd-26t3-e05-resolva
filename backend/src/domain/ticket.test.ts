import { describe, expect, it } from "vitest";
import { ticketContentSchema } from "./contracts.js";
import { transitionTicket } from "./ticket.js";

const content = {
  targetSystemKey: "demo",
  title: "Quantidade incorreta",
  description: "O total ignora a quantidade informada.",
  expectedBehavior: "Multiplicar preço pela quantidade.",
  category: "calculo",
};

describe("contratos do ticket", () => {
  it("normaliza espaços e passos opcionais antes da persistência", () => {
    expect(
      ticketContentSchema.parse({
        ...content,
        title: "  Quantidade incorreta  ",
        category: " calculo ",
        reproductionSteps: "   ",
      }),
    ).toEqual({ ...content, reproductionSteps: null });
  });
  it.each([
    ["title", 5],
    ["title", 140],
    ["description", 20],
    ["description", 10000],
    ["expectedBehavior", 10],
    ["expectedBehavior", 5000],
    ["reproductionSteps", 10000],
  ])("aceita o limite exato de %s com %s caracteres", (field, length) => {
    expect(ticketContentSchema.safeParse({ ...content, [field]: "a".repeat(length) }).success).toBe(
      true,
    );
  });
  it.each([
    ["title", 4],
    ["title", 141],
    ["description", 19],
    ["description", 10001],
    ["expectedBehavior", 9],
    ["expectedBehavior", 5001],
    ["reproductionSteps", 10001],
  ])("recusa fora do limite de %s com %s caracteres", (field, length) => {
    expect(ticketContentSchema.safeParse({ ...content, [field]: "a".repeat(length) }).success).toBe(
      false,
    );
  });
  it.each(["status", "version", "requestKey", "executionId"])(
    "recusa campo controlado pelo servidor: %s",
    (field) => {
      expect(ticketContentSchema.safeParse({ ...content, [field]: "valor-injetado" }).success).toBe(
        false,
      );
    },
  );
  it("recusa categoria sem formato válido e caractere nulo no relato", () => {
    expect(ticketContentSchema.safeParse({ ...content, category: "../../calculo" }).success).toBe(
      false,
    );
    expect(
      ticketContentSchema.safeParse({
        ...content,
        description: "Relato com caractere nulo\u0000 inválido.",
      }).success,
    ).toBe(false);
  });
});

describe("transições humanas", () => {
  it("complementar informação devolve o ticket para aberto", () => {
    expect(transitionTicket("aguardando_informacoes", { type: "provide_information" })).toBe(
      "aberto",
    );
  });
  it("contestar uma recusa devolve o ticket para aberto", () => {
    expect(transitionTicket("recusado", { type: "contest_triage" })).toBe("aberto");
  });
  it("resolve somente com merge e verificação em teste confirmados", () => {
    expect(
      transitionTicket("aguardando_revisao", {
        type: "resolve",
        mergeConfirmed: true,
        testVerified: true,
      }),
    ).toBe("resolvido");
    expect(() =>
      transitionTicket("aguardando_revisao", {
        type: "resolve",
        mergeConfirmed: true,
        testVerified: false,
      }),
    ).toThrow();
    expect(() =>
      transitionTicket("aguardando_revisao", {
        type: "resolve",
        mergeConfirmed: false,
        testVerified: true,
      }),
    ).toThrow();
  });
  it("reabrir ticket resolvido devolve para aberto", () => {
    expect(transitionTicket("resolvido", { type: "reopen" })).toBe("aberto");
  });
  it.each([
    "em_triagem",
    "recusado",
    "aguardando_implementacao",
    "em_andamento",
    "aguardando_revisao",
    "resolvido",
  ] as const)("impede edição em %s", (status) => {
    expect(() => transitionTicket(status, { type: "edit" })).toThrow();
  });
  it.each(["aberto", "aguardando_informacoes"] as const)(
    "permite edição em %s sem mudar estado",
    (status) => {
      expect(transitionTicket(status, { type: "edit" })).toBe(status);
    },
  );
  it("recusa operações em origem incompatível", () => {
    expect(() =>
      transitionTicket("aberto", { type: "resolve", mergeConfirmed: true, testVerified: true }),
    ).toThrow();
    expect(() => transitionTicket("aberto", { type: "reopen" })).toThrow();
    expect(() => transitionTicket("aberto", { type: "contest_triage" })).toThrow();
    expect(() => transitionTicket("em_andamento", { type: "provide_information" })).toThrow();
  });
});
