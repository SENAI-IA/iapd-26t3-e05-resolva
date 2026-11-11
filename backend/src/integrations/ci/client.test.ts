import { describe, expect, it, vi } from "vitest";
import { createPipelineClient, type PipelineTransport } from "./client.js";

const executionId = "11111111-1111-4111-8111-111111111111";
const callback = {
  schemaVersion: 1,
  executionId,
  repository: "equipe/alvo",
  workflowId: "987654",
  workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
  status: "success",
  branch: "resolva/res-1-abc",
  commitSha: "a".repeat(40),
  pullRequest: {
    number: 12,
    url: "https://github.com/equipe/alvo/pull/12",
    state: "OPEN" as const,
  },
  failureReason: null,
};

function transport() {
  return {
    dispatch: vi.fn<PipelineTransport["dispatch"]>(async () => ({
      workflowId: "987654",
      workflowUrl: "https://github.com/equipe/alvo/actions/runs/987654",
    })),
    reconcile: vi.fn<PipelineTransport["reconcile"]>(async () => callback),
  } satisfies PipelineTransport;
}

describe("cliente de pipeline", () => {
  it("valida o disparo e deduplica chamadas concorrentes pela execução", async () => {
    const adapter = transport();
    const client = createPipelineClient(adapter);
    const input = {
      executionId,
      repository: "equipe/alvo",
      workflow: "resolva.yml",
      ref: "main",
      fields: { executionId },
    };

    const [first, second] = await Promise.all([
      client.triggerPipeline(input),
      client.triggerPipeline(input),
    ]);

    expect(first).toEqual(second);
    expect(adapter.dispatch).toHaveBeenCalledTimes(1);
  });

  it("reconcilia callback e não inventa execução ausente", async () => {
    const adapter = transport();
    const client = createPipelineClient(adapter);
    const reference = await client.triggerPipeline({
      executionId,
      repository: "equipe/alvo",
      workflow: "resolva.yml",
      ref: "main",
    });

    await expect(client.reconcilePipeline(reference)).resolves.toMatchObject({
      executionId,
      status: "success",
    });
    adapter.reconcile.mockResolvedValueOnce(null);
    await expect(client.reconcilePipeline(reference)).resolves.toBeNull();
  });

  it("recusa entrada ou callback de outra execução", async () => {
    const adapter = transport();
    const client = createPipelineClient(adapter);
    await expect(
      client.triggerPipeline({
        executionId,
        repository: "https://github.com/equipe/alvo",
        workflow: "resolva.yml",
        ref: "main",
      }),
    ).rejects.toThrow();
    const reference = await client.triggerPipeline({
      executionId,
      repository: "equipe/alvo",
      workflow: "resolva.yml",
      ref: "main",
    });
    adapter.reconcile.mockResolvedValueOnce({
      ...callback,
      executionId: "22222222-2222-4222-8222-222222222222",
    });
    await expect(client.reconcilePipeline(reference)).rejects.toThrow(
      "Callback da pipeline inválido.",
    );
  });
});
