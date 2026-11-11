import { parseProjectConfig, createTargetSystemSnapshot } from "../config/project.js";

export const testTargetConfig = parseProjectConfig({
  targetSystemKey: "demo",
  displayName: "Sistema demo",
  version: 1,
  workflowRef: "resolva.yml",
  repository: "equipe/alvo",
  baseBranch: "main",
  repositoryRoot: "target",
  allowedPaths: ["src", "tests"],
  testPaths: ["tests"],
  documentationPaths: ["docs"],
  preparationCommands: [],
  validationCommands: [
    {
      id: "suite",
      executable: "pnpm",
      args: ["exec", "vitest", "run", "--reporter=json", "--outputFile={reportPath}"],
      cwd: ".",
      kind: "test",
    },
  ],
  regressionCommand: {
    id: "regressao",
    executable: "pnpm",
    args: ["exec", "vitest", "run", "--reporter=json", "--outputFile={reportPath}"],
    cwd: ".",
    kind: "test",
  },
  testAdapter: "vitest-json",
  kiroModel: "modelo-explicito",
});

export const testTargetSnapshot = createTargetSystemSnapshot(testTargetConfig);
