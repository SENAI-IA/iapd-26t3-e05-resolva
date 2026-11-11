import { describe, expect, it } from "vitest";
import { createGithubClient, GithubCliError, type GhExecution } from "./cli.js";
import { githubBranch, githubPullRequest, githubWorkflowRun } from "../../test/github.js";

function clientWithResponse(value: unknown, calls: string[][] = []) {
  const execute: GhExecution = async (args) => {
    calls.push([...args]);
    return { stdout: JSON.stringify(value), stderr: "" };
  };
  return createGithubClient({ execute });
}

describe("consultas autenticadas ao GitHub", () => {
  it("consulta workflow por identidade com GET no host fixo", async () => {
    const calls: string[][] = [];
    const client = clientWithResponse(githubWorkflowRun(), calls);
    await expect(
      client.getWorkflowRun({ repository: "equipe/alvo", workflowId: "987654" }),
    ).resolves.toEqual({
      id: "987654",
      url: "https://github.com/equipe/alvo/actions/runs/987654",
      workflowDefinitionId: "456",
      attempt: 1,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      headBranch: "main",
      headSha: "b".repeat(40),
      repository: "equipe/alvo",
    });
    expect(calls).toEqual([
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        "repos/equipe/alvo/actions/runs/987654",
      ],
    ]);
  });

  it.each(["queued", "in_progress", "requested", "waiting", "pending"])(
    "preserva workflow %s sem inventar conclusão",
    async (status) => {
      const client = clientWithResponse({ ...githubWorkflowRun(), status, conclusion: null });
      await expect(
        client.getWorkflowRun({ repository: "equipe/alvo", workflowId: "987654" }),
      ).resolves.toMatchObject({ status, conclusion: null });
    },
  );

  it.each([
    ["ID de outra execução", { id: 987655 }],
    ["repositório divergente", { repository: { full_name: "outro/alvo" } }],
    ["URL externa", { html_url: "https://externo.example/actions/runs/987654" }],
    ["URL com segredo", { html_url: "https://token@github.com/equipe/alvo/actions/runs/987654" }],
    ["URL de outro run", { html_url: "https://github.com/equipe/alvo/actions/runs/987655" }],
    ["ID sem precisão", { id: 9007199254740992 }],
    ["SHA inválido", { head_sha: "nao-e-sha" }],
  ])("recusa resposta de workflow com %s", async (_name, overrides) => {
    const client = clientWithResponse({ ...githubWorkflowRun(), ...overrides });
    await expect(
      client.getWorkflowRun({ repository: "equipe/alvo", workflowId: "987654" }),
    ).rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("normaliza a PR incluindo marcador, repositórios, branches e SHA", async () => {
    const calls: string[][] = [];
    const client = clientWithResponse({ ...githubPullRequest(), campoExtra: true }, calls);
    await expect(client.getPullRequest({ repository: "equipe/alvo", number: 12 })).resolves.toEqual(
      {
        number: 12,
        url: "https://github.com/equipe/alvo/pull/12",
        state: "OPEN",
        draft: false,
        body: "Corrige o total.\n<!-- resolva-delivery:11111111-1111-4111-8111-111111111111 -->",
        headRefName: "resolva/res-1-abc",
        baseRefName: "main",
        headSha: "a".repeat(40),
        headRepository: "equipe/alvo",
        baseRepository: "equipe/alvo",
      },
    );
    expect(calls).toEqual([
      ["api", "--hostname", "github.com", "--method", "GET", "repos/equipe/alvo/pulls/12"],
    ]);
  });

  it.each([
    ["closed", false, "CLOSED"],
    ["closed", true, "MERGED"],
  ])("distingue PR %s com merged=%s", async (state, merged, expected) => {
    const client = clientWithResponse({ ...githubPullRequest(), state, merged, body: null });
    await expect(
      client.getPullRequest({ repository: "equipe/alvo", number: 12 }),
    ).resolves.toMatchObject({
      state: expected,
      body: "",
    });
  });

  it.each([
    ["número divergente", { number: 13 }],
    ["base de outro repositório", { base: { ref: "main", repo: { full_name: "outro/alvo" } } }],
    ["URL divergente", { html_url: "https://github.com/outro/alvo/pull/12" }],
    ["origem apagada", { head: { ...githubPullRequest().head, repo: null } }],
  ])("recusa resposta de PR com %s", async (_name, overrides) => {
    const client = clientWithResponse({ ...githubPullRequest(), ...overrides });
    await expect(
      client.getPullRequest({ repository: "equipe/alvo", number: 12 }),
    ).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  it("confere a ponta da branch e codifica o nome dentro do endpoint", async () => {
    const calls: string[][] = [];
    const client = clientWithResponse(githubBranch(), calls);
    await expect(
      client.getBranchHead({ repository: "equipe/alvo", branch: "resolva/res-1-abc" }),
    ).resolves.toBe("a".repeat(40));
    expect(calls).toEqual([
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        "repos/equipe/alvo/git/ref/heads/resolva%2Fres-1-abc",
      ],
    ]);
  });

  it.each([
    { ref: "refs/tags/resolva/res-1-abc" },
    { object: { type: "tag", sha: "a".repeat(40) } },
    { object: { type: "commit", sha: "a".repeat(41) } },
  ])("recusa referência que não identifica a branch/commit: %j", async (overrides) => {
    const client = clientWithResponse({ ...githubBranch(), ...overrides });
    await expect(
      client.getBranchHead({ repository: "equipe/alvo", branch: "resolva/res-1-abc" }),
    ).rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("recusa parâmetros antes de consultar o GitHub", async () => {
    const calls: string[][] = [];
    const client = clientWithResponse({}, calls);
    await expect(
      client.getWorkflowRun({ repository: "equipe/alvo", workflowId: "../12" }),
    ).rejects.toThrow();
    await expect(
      client.getPullRequest({ repository: "https://externo.example/alvo", number: 12 }),
    ).rejects.toThrow();
    await expect(
      client.getBranchHead({ repository: "equipe/alvo", branch: "main\nsegredo" }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("não vaza JSON inválido nem transforma indisponibilidade em ausência", async () => {
    let unavailable = false;
    const client = createGithubClient({
      execute: async () => {
        if (unavailable)
          throw new GithubCliError("timeout", "O comando gh excedeu o tempo limite.");
        return { stdout: "segredo-ficticio", stderr: "" };
      },
    });
    await expect(
      client.getPullRequest({ repository: "equipe/alvo", number: 12 }),
    ).rejects.toMatchObject({
      reason: "invalid_response",
      message: "A resposta do GitHub não tem o formato esperado.",
    });
    unavailable = true;
    await expect(
      client.getPullRequest({ repository: "equipe/alvo", number: 12 }),
    ).rejects.toMatchObject({
      reason: "timeout",
    });
  });
});
