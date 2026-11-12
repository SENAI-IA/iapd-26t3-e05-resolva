import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "./process.js";

describe("supervisor de processos", () => {
  it("executa sem shell e captura saída limitada", async () => {
    const result = await runCommand({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('saída'); process.stderr.write('aviso')"],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      failure: null,
      timedOut: false,
      outputLimitExceeded: false,
      stdout: "saída",
      stderr: "aviso",
    });
  });

  it("envia entrada controlada sem habilitar shell", async () => {
    const result = await runCommand({
      executable: process.execPath,
      args: [
        "-e",
        "let value=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(value))",
      ],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      stdin: "contexto autorizado",
    });
    expect(result).toMatchObject({ exitCode: 0, stdout: "contexto autorizado" });
  });

  it("encerra processo que excede o tempo limite", async () => {
    const result = await runCommand({
      executable: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10_000)"],
      cwd: process.cwd(),
      timeoutMs: 50,
    });
    expect(result).toMatchObject({
      exitCode: null,
      timedOut: true,
      failure: "timeout",
    });
  });

  it("encerra processo que excede o limite de saída", async () => {
    const result = await runCommand({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(100_000))"],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result).toMatchObject({
      outputLimitExceeded: true,
      failure: "output_limit",
    });
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1024);
  });

  it("classifica executável inexistente sem lançar saída interna", async () => {
    const result = await runCommand({
      executable: "/caminho/inexistente/resolva-command",
      args: [],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    expect(result).toMatchObject({
      exitCode: null,
      signal: null,
      failure: "spawn",
    });
  });

  it("recusa limite de tempo, saída ou caminho inválido antes de criar processo", async () => {
    expect(() =>
      runCommand({ executable: process.execPath, args: [], cwd: process.cwd(), timeoutMs: 0 }),
    ).toThrow("Tempo limite de comando inválido.");
    expect(() =>
      runCommand({
        executable: process.execPath,
        args: [],
        cwd: process.cwd(),
        timeoutMs: 1_000,
        maxOutputBytes: 0,
      }),
    ).toThrow("Limite de saída inválido.");
    expect(() =>
      runCommand({ executable: "node\0unsafe", args: [], cwd: process.cwd(), timeoutMs: 1_000 }),
    ).toThrow("Executável de comando inválido.");
  });
});

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("grupo de processos", () => {
  it("encerra descendentes junto com o processo supervisionado", async () => {
    const directory = mkdtempSync(join(tmpdir(), "resolva-process-"));
    temporaryDirectories.push(directory);
    const childPidPath = join(directory, "child.pid");
    const script = [
      "const { spawn } = require('node:child_process');",
      "const fs = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', \"setInterval(() => {}, 10000)\"], { stdio: 'ignore' });",
      "fs.writeFileSync(process.argv[1], String(child.pid));",
      "setInterval(() => {}, 10000);",
    ].join(" ");

    const result = await runCommand({
      executable: process.execPath,
      args: ["-e", script, childPidPath],
      cwd: directory,
      timeoutMs: 100,
    });

    expect(result).toMatchObject({ timedOut: true, failure: "timeout" });
    const childPid = Number(readFileSync(childPidPath, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(() => process.kill(childPid, 0)).toThrow();
  });
});
