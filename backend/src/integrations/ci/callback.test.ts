import { describe, expect, it } from "vitest";
import {
  isTerminalPipelineStatus,
  parsePipelineCallback,
  pipelineCallbackFingerprint,
} from "./callback.js";

const executionId = "11111111-1111-4111-8111-111111111111";
const repository = "equipe/alvo";

function callback(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    executionId,
    repository,
    workflowId: "987654",
    workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
    status: "success",
    branch: "resolva/res-1-abc",
    commitSha: "a".repeat(40),
    pullRequest: {
      number: 12,
      url: "https://github.com/equipe/alvo/pull/12",
      state: "OPEN",
    },
    failureReason: null,
    ...overrides,
  };
}

describe("callback da pipeline", () => {
  it("valida sucesso com workflow, SHA e PR do repositório esperado", () => {
    const parsed = parsePipelineCallback(callback(), { executionId, repository });
    expect(parsed.status).toBe("success");
    expect(pipelineCallbackFingerprint(parsed)).toMatch(/^[a-f0-9]{64}$/u);
    expect(isTerminalPipelineStatus(parsed.status)).toBe(true);
  });

  it("aceita estados intermediários e falha com diagnóstico", () => {
    expect(
      parsePipelineCallback(
        callback({ status: "running", branch: null, commitSha: null, pullRequest: null }),
        { executionId, repository },
      ).status,
    ).toBe("running");
    expect(
      parsePipelineCallback(
        callback({
          status: "failure",
          branch: null,
          commitSha: null,
          pullRequest: null,
          failureReason: "Teste falhou.",
        }),
        { executionId, repository },
      ).failureReason,
    ).toBe("Teste falhou.");
    expect(isTerminalPipelineStatus("queued")).toBe(false);
  });

  it.each([
    ["execução diferente", { executionId: "22222222-2222-4222-8222-222222222222" }],
    ["repositório diferente", { repository: "outro/alvo" }],
    [
      "workflow com credencial na URL",
      { workflowUrl: "https://token@github.com/equipe/alvo/actions/runs/987654" },
    ],
    [
      "workflow com porta alternativa",
      { workflowUrl: "https://github.com:8443/equipe/alvo/actions/runs/987654" },
    ],
    [
      "workflow com query",
      { workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654?token=ficticio" },
    ],
    [
      "workflow com fragmento",
      { workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654#ficticio" },
    ],
    [
      "workflow sem ID numérico",
      { workflowId: "abc", workflowUrl: "https://github.com/equipe/alvo/actions/runs/abc" },
    ],
    [
      "URL de workflow de outro repositório",
      { workflowUrl: "https://github.com/outro/alvo/actions/runs/987654" },
    ],
    ["sucesso sem PR", { pullRequest: null }],
    ["falha sem diagnóstico", { status: "failure", failureReason: null }],
    [
      "PR de outro repositório em estado intermediário",
      {
        status: "running",
        pullRequest: { number: 12, url: "https://github.com/outro/alvo/pull/12", state: "OPEN" },
      },
    ],
    [
      "PR com credencial na URL",
      {
        pullRequest: {
          number: 12,
          url: "https://token@github.com/equipe/alvo/pull/12",
          state: "OPEN",
        },
      },
    ],
    [
      "PR fechada",
      {
        pullRequest: { number: 12, url: "https://github.com/equipe/alvo/pull/12", state: "CLOSED" },
      },
    ],
  ])("recusa %s", (_name, overrides) => {
    expect(() => parsePipelineCallback(callback(overrides), { executionId, repository })).toThrow(
      "Callback da pipeline inválido.",
    );
  });
});
