import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectConfig, parseProjectConfig, createTargetSystemSnapshot } from "./project.js";

function input() {
  return {
    targetSystemKey: "demo",
    displayName: "Sistema demo",
    version: 1,
    pipelineRef: "main",
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
      args: ["exec", "vitest", "run", "{reportPath}"],
      cwd: ".",
      kind: "test",
    },
    testAdapter: "vitest-json",
    kiroModel: "modelo-explicito",
  };
}

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "resolva-config-"));
  temporaryDirectories.push(root);
  for (const path of ["target/src", "target/tests", "target/docs"])
    mkdirSync(join(root, path), { recursive: true });
  const path = join(root, "resolva.config.json");
  writeFileSync(path, JSON.stringify(input()));
  return { root, path };
}

describe("configuração do projeto", () => {
  it("aplica os limites e categorias padrão sem alterar a entrada", () => {
    const original = input();
    expect(parseProjectConfig(original)).toMatchObject({
      maxRounds: 3,
      runTimeoutSeconds: 1800,
      commandTimeoutSeconds: 300,
      kiroTimeoutSeconds: 300,
      maxChangedFiles: 20,
      maxChangedLines: 1000,
      workspaceRoot: ".resolva/workspaces",
      artifactRoot: ".resolva/artifacts",
      categories: [
        { slug: "validacao_entrada", label: "Validação de entrada" },
        { slug: "regra_negocio", label: "Regra de negócio" },
        { slug: "calculo", label: "Cálculo" },
      ],
    });
    expect(original).not.toHaveProperty("maxRounds");
  });

  it("gera snapshot versionado sem alterar a configuração validada", () => {
    const config = parseProjectConfig(input());
    const snapshot = createTargetSystemSnapshot(config);
    expect(snapshot).toMatchObject({
      targetSystemKey: "demo",
      version: 1,
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(snapshot).not.toBe(config);
    expect(config).not.toHaveProperty("snapshotHash");
  });
  it("recusa identidade ou referência de pipeline inválidas", () => {
    expect(() => parseProjectConfig({ ...input(), targetSystemKey: "Demo System" })).toThrow();
    expect(() => parseProjectConfig({ ...input(), displayName: " " })).toThrow();
    expect(() => parseProjectConfig({ ...input(), pipelineRef: "main; echo" })).toThrow();
  });
  it.each([
    ["runTimeoutSeconds", 59],
    ["runTimeoutSeconds", 3601],
    ["commandTimeoutSeconds", 0],
    ["kiroTimeoutSeconds", 3601],
    ["maxChangedFiles", 0],
    ["maxChangedLines", -1],
  ])("recusa limite inválido %s=%s", (key, value) => {
    expect(() => parseProjectConfig({ ...input(), [key]: value })).toThrow();
  });
  it.each([60, 299])(
    "aceita timeout global %s com os defaults dos comandos",
    (runTimeoutSeconds) => {
      expect(parseProjectConfig({ ...input(), runTimeoutSeconds })).toMatchObject({
        runTimeoutSeconds,
        commandTimeoutSeconds: 300,
        kiroTimeoutSeconds: 300,
      });
    },
  );
  it.each([
    "../src",
    "/tmp/src",
    "src/../tests",
    "**",
    "src/*",
    "src\\..\\tests",
    "src//orders",
    "src\u0000",
  ])("recusa caminho não autorizado %s", (path) => {
    expect(() => parseProjectConfig({ ...input(), allowedPaths: [path] })).toThrow();
  });
  it("compara testPaths por diretório, sem aceitar prefixos textuais", () => {
    expect(() =>
      parseProjectConfig({ ...input(), allowedPaths: ["test"], testPaths: ["tests"] }),
    ).toThrow();
    expect(() =>
      parseProjectConfig({ ...input(), allowedPaths: ["src"], testPaths: ["src/tests"] }),
    ).not.toThrow();
  });
  it.each([".git", ".kiro/hooks", "node_modules", "src/.env.local"])(
    "recusa caminho de escrita sensível: %s",
    (path) => {
      expect(() => parseProjectConfig({ ...input(), allowedPaths: [path, "tests"] })).toThrow();
    },
  );
  it.each([
    "https://github.com/equipe/alvo",
    "equipe/alvo.git",
    "token-ficticio@github.com/equipe/alvo",
  ])("exige repository sem URL ou credencial: %s", (repository) => {
    expect(() => parseProjectConfig({ ...input(), repository })).toThrow();
  });
  it.each(["-main", "main..other", "refs/heads/@{main}", "main; echo", "main.lock"])(
    "recusa branch sintaticamente inválida: %s",
    (baseBranch) => {
      expect(() => parseProjectConfig({ ...input(), baseBranch })).toThrow();
    },
  );
  it("recusa comando livre, shell explícito e campo desconhecido", () => {
    expect(() =>
      parseProjectConfig({ ...input(), preparationCommands: ["pnpm test; echo segredo"] }),
    ).toThrow();
    expect(() =>
      parseProjectConfig({
        ...input(),
        preparationCommands: [{ id: "shell", executable: "bash", args: ["-c", "echo"], cwd: "." }],
      }),
    ).toThrow();
    expect(() => parseProjectConfig({ ...input(), GH_TOKEN: "segredo-ficticio" })).toThrow(
      "Configuração do projeto inválida.",
    );
  });
  it("exige teste com caminho de relatório reservado e IDs distintos", () => {
    expect(() => parseProjectConfig({ ...input(), validationCommands: [] })).toThrow();
    expect(() =>
      parseProjectConfig({
        ...input(),
        validationCommands: [
          { id: "suite", executable: "pnpm", args: ["test"], cwd: ".", kind: "test" },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseProjectConfig({
        ...input(),
        regressionCommand: { ...input().regressionCommand, id: "suite" },
      }),
    ).toThrow();
  });
  it("recusa categorias duplicadas e modelo ausente", () => {
    expect(() =>
      parseProjectConfig({
        ...input(),
        categories: [
          { slug: "calculo", label: "Um" },
          { slug: "calculo", label: "Dois" },
        ],
      }),
    ).toThrow();
    expect(() => parseProjectConfig({ ...input(), kiroModel: "" })).toThrow();
  });
  it("carrega caminhos relativos ao arquivo, sem depender do diretório do processo", () => {
    expect(loadProjectConfig(project().path)).toMatchObject({
      repository: "equipe/alvo",
      maxRounds: 3,
    });
  });
  it("recusa alvo ausente e JSON malformado sem expor o conteúdo", () => {
    const { root, path } = project();
    writeFileSync(path, JSON.stringify({ ...input(), repositoryRoot: "ausente" }));
    expect(() => loadProjectConfig(path)).toThrow();
    writeFileSync(path, '{"token-ficticio-secreto":');
    expect(() => loadProjectConfig(path)).toThrow(
      "Não foi possível carregar a configuração do projeto.",
    );
    expect(() => loadProjectConfig(join(root, "inexistente.json"))).toThrow(
      "Não foi possível carregar a configuração do projeto.",
    );
  });
  it("recusa symlink de fonte que escapa do alvo", () => {
    const { root, path } = project();
    mkdirSync(join(root, "externo"));
    symlinkSync(join(root, "externo"), join(root, "target/src/link"));
    writeFileSync(path, JSON.stringify({ ...input(), allowedPaths: ["src/link/new", "tests"] }));
    expect(() => loadProjectConfig(path)).toThrow();
  });
  it("recusa diretório de escrita apontando para metadados Git", () => {
    const { root, path } = project();
    mkdirSync(join(root, "target/.git"));
    symlinkSync(join(root, "target/.git"), join(root, "target/alias"));
    writeFileSync(path, JSON.stringify({ ...input(), allowedPaths: ["alias", "tests"] }));
    expect(() => loadProjectConfig(path)).toThrow();
  });
  it("recusa alias que transforma o caminho de escrita na raiz inteira do alvo", () => {
    const { root, path } = project();
    symlinkSync(join(root, "target"), join(root, "target/alias"));
    writeFileSync(
      path,
      JSON.stringify({ ...input(), allowedPaths: ["alias"], testPaths: ["alias/tests"] }),
    );
    expect(() => loadProjectConfig(path)).toThrow();
  });
  it("exige testPaths fisicamente contidos nos caminhos permitidos", () => {
    const { root, path } = project();
    mkdirSync(join(root, "target/other-tests"));
    symlinkSync(join(root, "target/other-tests"), join(root, "target/src/regressions"));
    writeFileSync(
      path,
      JSON.stringify({ ...input(), allowedPaths: ["src"], testPaths: ["src/regressions"] }),
    );
    expect(() => loadProjectConfig(path)).toThrow();
  });
  it("recusa cwd que é arquivo", () => {
    const { root, path } = project();
    writeFileSync(join(root, "target/arquivo"), "conteúdo");
    writeFileSync(
      path,
      JSON.stringify({
        ...input(),
        preparationCommands: [
          { id: "preparar", executable: "pnpm", args: ["install"], cwd: "arquivo" },
        ],
      }),
    );
    expect(() => loadProjectConfig(path)).toThrow();
  });
  it("recusa runtime dentro do alvo ou sobreposto, inclusive por symlink", () => {
    const { root, path } = project();
    for (const override of [
      { workspaceRoot: "target/workspaces" },
      { workspaceRoot: ".resolva", artifactRoot: ".resolva/artifacts" },
    ]) {
      writeFileSync(path, JSON.stringify({ ...input(), ...override }));
      expect(() => loadProjectConfig(path)).toThrow();
    }
    symlinkSync(join(root, "target"), join(root, "runtime"));
    writeFileSync(path, JSON.stringify({ ...input(), workspaceRoot: "runtime/workspaces" }));
    expect(() => loadProjectConfig(path)).toThrow();
  });
});
