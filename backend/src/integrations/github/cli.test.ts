import { describe, expect, it, vi } from "vitest";
import { createGithubClient, type GhExecution } from "./cli.js";

const pullRequest = {
  number: 12,
  url: "https://github.com/equipe/alvo/pull/12",
  state: "OPEN" as const,
  headRefName: "resolva/res-1-abc",
  baseRefName: "main",
};

function executor(outputs: Array<{ stdout: string; stderr: string }> | Error[]) {
  let index = 0;
  return vi.fn<GhExecution>(async () => {
    const output = outputs[index++];
    if (!output) throw new Error("Resposta de teste ausente.");
    if (output instanceof Error) throw output;
    return output;
  });
}

describe("cliente GitHub CLI", () => {
  it("verifica instalação e autenticação sem expor o token aos argumentos", async () => {
    const execute = executor([
      { stdout: "gh version 2.45.0", stderr: "" },
      { stdout: "", stderr: "Logged in" },
    ]);
    const client = createGithubClient({ token: "token-ficticio", execute });

    await expect(client.checkAvailability()).resolves.toEqual({
      installed: true,
      authenticated: true,
    });
    expect(execute).toHaveBeenNthCalledWith(
      1,
      ["--version"],
      expect.objectContaining({ token: "token-ficticio", timeoutMs: 30_000 }),
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      ["auth", "status", "--hostname", "github.com"],
      expect.anything(),
    );
  });

  it("lista PRs com argumentos separados e valida a resposta", async () => {
    const execute = executor([{ stdout: JSON.stringify([pullRequest]), stderr: "" }]);
    const client = createGithubClient({ execute });

    await expect(
      client.listPullRequests({ repository: "equipe/alvo", head: pullRequest.headRefName }),
    ).resolves.toEqual([pullRequest]);
    expect(execute).toHaveBeenCalledWith(
      [
        "pr",
        "list",
        "--repo",
        "equipe/alvo",
        "--head",
        pullRequest.headRefName,
        "--state",
        "all",
        "--limit",
        "20",
        "--json",
        "number,url,state,headRefName,baseRefName",
      ],
      expect.anything(),
    );
  });

  it("reutiliza PR existente e não cria uma duplicada", async () => {
    const execute = executor([{ stdout: JSON.stringify([pullRequest]), stderr: "" }]);
    const client = createGithubClient({ execute });

    await expect(
      client.createOrReusePullRequest({
        repository: "equipe/alvo",
        head: pullRequest.headRefName,
        base: "main",
        title: "Corrige total",
        body: "<!-- resolva-delivery:1 -->",
      }),
    ).resolves.toEqual(pullRequest);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("cria PR sem shell e reconcilia a URL devolvida pelo gh", async () => {
    const execute = executor([
      { stdout: "[]", stderr: "" },
      { stdout: "https://github.com/equipe/alvo/pull/13\n", stderr: "" },
    ]);
    const client = createGithubClient({ execute });

    await expect(
      client.createOrReusePullRequest({
        repository: "equipe/alvo",
        head: "resolva/res-2-def",
        base: "main",
        title: "Corrige total",
        body: "Descrição factual",
      }),
    ).resolves.toMatchObject({
      number: null,
      url: "https://github.com/equipe/alvo/pull/13",
      state: "OPEN",
    });
    expect(execute).toHaveBeenCalledWith(
      [
        "pr",
        "list",
        "--repo",
        "equipe/alvo",
        "--head",
        "resolva/res-2-def",
        "--state",
        "all",
        "--limit",
        "20",
        "--json",
        "number,url,state,headRefName,baseRefName",
      ],
      expect.anything(),
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      [
        "pr",
        "create",
        "--repo",
        "equipe/alvo",
        "--head",
        "resolva/res-2-def",
        "--base",
        "main",
        "--title",
        "Corrige total",
        "--body",
        "Descrição factual",
      ],
      expect.anything(),
    );
  });

  it("dispara workflow com campos validados sem montar comando por shell", async () => {
    const execute = executor([{ stdout: "", stderr: "" }]);
    const client = createGithubClient({ execute });

    await client.triggerWorkflow({
      repository: "equipe/alvo",
      workflow: "resolva.yml",
      ref: "main",
      fields: { executionId: "abc-123" },
    });
    expect(execute).toHaveBeenCalledWith(
      [
        "workflow",
        "run",
        "resolva.yml",
        "--repo",
        "equipe/alvo",
        "--ref",
        "main",
        "--field",
        "executionId=abc-123",
      ],
      expect.anything(),
    );
  });
});
