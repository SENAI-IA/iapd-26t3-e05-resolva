import { existsSync } from "node:fs";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runKiroTriage, type KiroCommand } from "./client.js";

const executionId = "c9739121-7755-47db-b7cf-dc98c35c4d2f";
const identity = { executionId, ticketId: 7, ticketVersion: 2 };
const ticket = {
  id: 7,
  version: 2,
  title: "Quantidade incorreta",
  description: "O total ignora a quantidade informada.",
  expectedBehavior: "O total multiplica preço pela quantidade.",
};
const sources = [{ path: "docs/regra.md", text: "Regra vigente\nPreço × quantidade\n" }];
const apiKey = "kiro-credencial-ficticia";
const input = {
  executionId,
  ticket,
  sources,
  executable: "/opt/kiro/bin/kiro-cli",
  model: "modelo-configurado",
  apiKey,
  secretValues: ["senha-ficticia-do-banco"],
  timeoutSeconds: 30,
};
const report = {
  schemaVersion: 1,
  ...identity,
  kind: "triage",
  phase: "triage",
  round: 0,
  classification: "bug",
  promptVersion: "triage-v1",
  summary: "A quantidade é ignorada.",
  observedBehavior: "O total reflete apenas o preço.",
  expectedBehavior: "O total inclui a quantidade.",
  ruleInterpretation: "Multiplicar preço por quantidade.",
  diagnosis: "A operação usa somente o preço.",
  references: [{ path: "docs/regra.md", startLine: 2, endLine: 2 }],
  uncertainties: [],
  nextAction: "Aguardar início manual.",
  changeScope: null,
  acceptanceCriteria: [],
  regressionTestPlan: "Validar um pedido com quantidade dois.",
  evidence: {
    ruleStatus: "established",
    behavior: "divergent",
    verificationStatus: "not_run",
    evidenceSufficient: true,
    changeRequested: false,
    expectationMisunderstood: false,
    sources: [
      {
        path: "docs/regra.md",
        sha256: "b3badffee1f0ad9057eb49a566deeb901b2002c0238042a93ab26f2770a88010",
      },
    ],
    questions: [],
    humanReviewRequired: false,
  },
};

function reportFile(command: KiroCommand) {
  return join(command.cwd, ".resolva", "reports", executionId, "triage-0.json");
}

describe("triagem Kiro em workspace descartável", () => {
  it("entrega apenas contexto autorizado, credencial do Kiro e permissões específicas", async () => {
    let cwd = "";
    const result = await runKiroTriage(input, async (command) => {
      cwd = command.cwd;
      expect(command.executable).toBe(input.executable);
      expect(command.args).toEqual([
        "chat",
        "--v3",
        "--no-interactive",
        "--output-format",
        "stream-json",
        "--agent",
        "resolva-triage",
        "--model=modelo-configurado",
        "--trust-workspace",
      ]);
      expect(command.shell).toBe(false);
      expect(command.timeoutMs).toBe(30000);
      expect(command.env).toMatchObject({ KIRO_API_KEY: apiKey });
      expect(command.env).not.toHaveProperty("DATABASE_URL");
      expect(command.env).not.toHaveProperty("GH_TOKEN");
      expect(command.stdin).not.toContain(apiKey);
      expect(command.stdin).toContain(report.evidence.sources[0]?.sha256);
      expect(command.stdin).toContain(ticket.description);
      expect(await readFile(join(cwd, "context/1.txt"), "utf8")).toBe(sources[0]?.text);
      const profile = JSON.parse(
        await readFile(join(cwd, ".kiro/agents/resolva-triage.json"), "utf8"),
      );
      expect(profile).toMatchObject({
        tools: ["read_file", "fs_write"],
        includeMcpJson: false,
        includePowers: false,
        permissions: {
          rules: expect.arrayContaining([
            { capability: "fs_read", match: ["context/1.txt"], effect: "allow" },
            { capability: "fs_read", exclude: ["context/1.txt"], effect: "deny" },
            {
              capability: "fs_write",
              exclude: [`.resolva/reports/${executionId}/triage-0.json`],
              effect: "deny",
            },
            {
              capability: "fs_write",
              match: [`.resolva/reports/${executionId}/triage-0.json`],
              effect: "allow",
            },
            { capability: "shell", effect: "deny" },
            { capability: "mcp", effect: "deny" },
            { capability: "subagent", effect: "deny" },
            { capability: "web_fetch", effect: "deny" },
            { capability: "web_search", effect: "deny" },
          ]),
        },
      });
      await writeFile(reportFile(command), JSON.stringify(report));
      return { exitCode: 0 };
    });
    expect(result).toMatchObject({ summary: report.summary, evidence: report.evidence });
    expect(result).not.toHaveProperty("executionId");
    expect(existsSync(cwd)).toBe(false);
  });

  it("envia referências do relato e arquivos de instrução como dados literais", async () => {
    const description = "O erro ocorre ao inserir @/etc/hosts no campo de exemplo.";
    await runKiroTriage(
      {
        ...input,
        ticket: { ...ticket, description },
        sources: [...sources, { path: "AGENTS.md", text: "Instrução do repositório-alvo." }],
      },
      async (command) => {
        expect(command.stdin).not.toContain("@/etc/hosts");
        const context = JSON.parse(command.stdin.split("\n").at(-1) ?? "");
        expect(context).toMatchObject({
          ticket: { description },
          sources: expect.arrayContaining([
            { path: "AGENTS.md", readPath: "context/2.txt", sha256: expect.any(String) },
          ]),
        });
        expect(existsSync(join(command.cwd, "context/AGENTS.md"))).toBe(false);
        expect(await readFile(join(command.cwd, "context/2.txt"), "utf8")).toBe(
          "Instrução do repositório-alvo.",
        );
        await writeFile(reportFile(command), JSON.stringify(report));
        return { exitCode: 0 };
      },
    );
  });

  it.each([
    { executionId: "bbdf5942-76ba-40c4-a050-4041d25d6904" },
    { ticketVersion: 3 },
    { phase: "fix" },
    { classification: "falso_positivo" },
    { summary: apiKey },
    { references: [{ path: "docs/regra.md", startLine: 3, endLine: 3 }] },
    {
      evidence: { ...report.evidence, sources: [{ path: "docs/fora.md", sha256: "a".repeat(64) }] },
      references: [],
    },
    {
      evidence: {
        ...report.evidence,
        sources: [{ path: "docs/regra.md", sha256: "a".repeat(64) }],
      },
    },
    { evidence: { ...report.evidence, verificationStatus: "succeeded" } },
  ])("rejeita relatório incompatível com a reserva ou com o contexto", async (override) => {
    await expect(
      runKiroTriage(input, async (command) => {
        await writeFile(reportFile(command), JSON.stringify({ ...report, ...override }));
        return { exitCode: 0 };
      }),
    ).rejects.toThrow("Relatório de triagem inválido.");
  });

  it("aceita pedido de informação sem fabricar fonte ou plano de regressão", async () => {
    const result = await runKiroTriage(input, async (command) => {
      await writeFile(
        reportFile(command),
        JSON.stringify({
          ...report,
          classification: "inconclusivo",
          references: [],
          regressionTestPlan: null,
          evidence: { ...report.evidence, sources: [], questions: ["Qual quantidade foi usada?"] },
        }),
      );
      return { exitCode: 0 };
    });
    expect(result.evidence.questions).toEqual(["Qual quantidade foi usada?"]);
    expect(result.regressionTestPlan).toBeNull();
  });

  it.each(["ausente", "grande", "symlink"] as const)(
    "rejeita relatório %s após exit zero",
    async (kind) => {
      await expect(
        runKiroTriage(input, async (command) => {
          if (kind === "grande") await writeFile(reportFile(command), " ".repeat(65537));
          if (kind === "symlink") {
            const regular = join(command.cwd, "outro.json");
            await writeFile(regular, JSON.stringify(report));
            await symlink(regular, reportFile(command));
          }
          return { exitCode: 0 };
        }),
      ).rejects.toThrow("Relatório de triagem inválido.");
    },
  );

  it("rejeita exit code diferente de zero e remove o workspace", async () => {
    let cwd = "";
    await expect(
      runKiroTriage(input, async (command) => {
        cwd = command.cwd;
        await writeFile(reportFile(command), JSON.stringify(report));
        return { exitCode: 1 };
      }),
    ).rejects.toThrow("O processo de triagem do Kiro falhou.");
    expect(existsSync(cwd)).toBe(false);
  });

  it.each([
    { path: "../fora.md", text: "não autorizada" },
    { path: "docs/*", text: "padrão de permissão" },
    { path: "docs/.env", text: "arquivo sensível" },
    { path: "docs/regra.md", text: "senha-ficticia-do-banco" },
  ])("recusa fonte insegura antes de chamar o Kiro", async (source) => {
    const execute = vi.fn();
    await expect(runKiroTriage({ ...input, sources: [source] }, execute)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
