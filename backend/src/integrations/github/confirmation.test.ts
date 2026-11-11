import { describe, expect, it } from "vitest";
import { createGithubClient, GithubCliError, type GhExecution } from "./cli.js";
import { githubBranch, githubPullRequest } from "../../test/github.js";

const input = {
  repository: "equipe/alvo",
  deliveryId: "11111111-1111-4111-8111-111111111111",
  branch: "resolva/res-1-abc",
  baseBranch: "main",
  validatedSha: "a".repeat(40),
  prNumber: 12,
};

function reader(pullRequest = githubPullRequest(), branch = githubBranch()) {
  const calls: string[][] = [];
  const execute: GhExecution = async (args) => {
    calls.push([...args]);
    const endpoint = args.at(-1);
    if (endpoint === "repos/equipe/alvo/pulls/12")
      return { stdout: JSON.stringify(pullRequest), stderr: "" };
    if (endpoint === "repos/equipe/alvo/git/ref/heads/resolva%2Fres-1-abc")
      return { stdout: JSON.stringify(branch), stderr: "" };
    throw new Error("Consulta inesperada.");
  };
  return { client: createGithubClient({ execute }), calls };
}

describe("confirmação remota da entrega", () => {
  it("confirma apenas a PR e a branch correspondentes à entrega e ao SHA validado", async () => {
    const { client, calls } = reader();
    await expect(client.confirmDelivery(input)).resolves.toEqual({
      deliveryId: "11111111-1111-4111-8111-111111111111",
      repository: "equipe/alvo",
      branchName: "resolva/res-1-abc",
      baseBranch: "main",
      validatedSha: "a".repeat(40),
      remoteHeadSha: "a".repeat(40),
      prNumber: 12,
      prUrl: "https://github.com/equipe/alvo/pull/12",
      prState: "OPEN",
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((args) => args[0] === "api" && args[4] === "GET")).toBe(true);
  });

  it("repete a consulta após resposta perdida sem repetir a publicação", async () => {
    const { client, calls } = reader();
    const first = await client.confirmDelivery(input);
    await expect(client.confirmDelivery(input)).resolves.toEqual(first);
    expect(calls.map((args) => args.at(-1))).toEqual([
      "repos/equipe/alvo/pulls/12",
      "repos/equipe/alvo/git/ref/heads/resolva%2Fres-1-abc",
      "repos/equipe/alvo/pulls/12",
      "repos/equipe/alvo/git/ref/heads/resolva%2Fres-1-abc",
    ]);
  });

  it.each([
    ["branch de origem diferente", { head: { ...githubPullRequest().head, ref: "resolva/outra" } }],
    ["branch base diferente", { base: { ...githubPullRequest().base, ref: "release" } }],
    [
      "fork com mesma branch",
      { head: { ...githubPullRequest().head, repo: { full_name: "outro/alvo" } } },
    ],
    ["SHA da PR divergente", { head: { ...githubPullRequest().head, sha: "b".repeat(40) } }],
    ["marcador ausente", { body: "Correção do total" }],
    [
      "marcador de outra entrega",
      { body: "<!-- resolva-delivery:22222222-2222-4222-8222-222222222222 -->" },
    ],
    [
      "marcadores ambíguos",
      {
        body: `${githubPullRequest().body}\n<!-- resolva-delivery:22222222-2222-4222-8222-222222222222 -->`,
      },
    ],
  ])("recusa %s", async (_name, overrides) => {
    const { client, calls } = reader({ ...githubPullRequest(), ...overrides });
    await expect(client.confirmDelivery(input)).rejects.toMatchObject({
      reason: "remote_conflict",
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["fechada", { state: "closed", merged: false }],
    ["integrada", { state: "closed", merged: true }],
    ["rascunho", { draft: true }],
  ])("não confirma PR %s como pronta para revisão", async (_name, overrides) => {
    const { client } = reader({ ...githubPullRequest(), ...overrides });
    await expect(client.confirmDelivery(input)).rejects.toMatchObject({ reason: "not_reviewable" });
  });

  it("recusa branch que avançou depois do SHA validado mesmo com PR ainda consistente", async () => {
    const { client } = reader(githubPullRequest(), {
      ...githubBranch(),
      object: { type: "commit", sha: "b".repeat(40) },
    });
    await expect(client.confirmDelivery(input)).rejects.toMatchObject({
      reason: "remote_conflict",
    });
  });

  it("respeita a capitalização canônica devolvida pelo GitHub para o mesmo repositório", async () => {
    const pr = githubPullRequest();
    const { client } = reader({
      ...pr,
      html_url: "https://github.com/Equipe/Alvo/pull/12",
      head: { ...pr.head, repo: { full_name: "Equipe/Alvo" } },
      base: { ...pr.base, repo: { full_name: "Equipe/Alvo" } },
    });
    await expect(client.confirmDelivery(input)).resolves.toMatchObject({
      prUrl: "https://github.com/Equipe/Alvo/pull/12",
    });
  });

  it.each([
    { deliveryId: "nao-e-uuid" },
    { validatedSha: "a".repeat(41) },
    { repository: "equipe/../alvo" },
    { branch: "resolva/../main" },
    { prNumber: 0 },
  ])("recusa identidade local inválida antes de consultar: %j", async (overrides) => {
    const { client, calls } = reader();
    await expect(client.confirmDelivery({ ...input, ...overrides })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it.each(["PR", "branch"])(
    "mantém indisponibilidade na consulta da %s como erro",
    async (step) => {
      let call = 0;
      const client = createGithubClient({
        execute: async () => {
          call++;
          if (step === "PR" || call === 2)
            throw new GithubCliError("timeout", "O comando gh excedeu o tempo limite.");
          return { stdout: JSON.stringify(githubPullRequest()), stderr: "" };
        },
      });
      await expect(client.confirmDelivery(input)).rejects.toMatchObject({ reason: "timeout" });
      expect(call).toBe(step === "PR" ? 1 : 2);
    },
  );
});
