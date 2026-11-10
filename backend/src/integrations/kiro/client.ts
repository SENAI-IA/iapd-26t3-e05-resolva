import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { ticketVersionSchema, triageSourcePathSchema } from "../../domain/contracts.js";
import { buildTriageProfile, triageAgentName } from "./profile.js";
import { containsSecret, readTriageReport } from "./report.js";
import { buildTriagePrompt, type TriageTicketContext } from "./triagePrompt.js";

const maxContextBytes = 512 * 1024;
const maxSources = 100;

export interface KiroCommand {
  executable: string;
  args: readonly string[];
  cwd: string;
  shell: false;
  env: Readonly<Record<string, string>>;
  stdin: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface KiroTriageInput {
  executionId: string;
  ticket: TriageTicketContext;
  sources: readonly { path: string; text: string }[];
  executable: string;
  model: string;
  apiKey: string;
  secretValues?: readonly string[];
  timeoutSeconds: number;
}

const sourcePathSchema = triageSourcePathSchema.refine(
  (path) =>
    !/[!*?\u005b\u005d{}()|]/u.test(path) &&
    path
      .split("/")
      .every(
        (part) =>
          !part.startsWith(".") &&
          !/^(?:node_modules|id_(?:rsa|ed25519)|credentials(?:\.json)?)$/iu.test(part) &&
          !/\.(?:pem|key|p12|pfx)$/iu.test(part),
      ),
);

export async function runKiroTriage(
  input: KiroTriageInput,
  // O supervisor deve aplicar os limites e aguardar o encerramento do grupo antes de retornar.
  execute: (command: KiroCommand) => Promise<{ exitCode: number | null }>,
) {
  const identity = {
    executionId: z.uuid().parse(input.executionId),
    ticketId: ticketVersionSchema.shape.ticketId.parse(input.ticket.id),
    ticketVersion: ticketVersionSchema.shape.expectedVersion.parse(input.ticket.version),
  };
  const model = z.string().trim().min(1).max(200).parse(input.model);
  const timeoutMs = z.number().int().min(1).max(3600).parse(input.timeoutSeconds) * 1000;
  if (!isAbsolute(input.executable) || !input.apiKey)
    throw new Error("Configuração do Kiro inválida.");
  const secrets = [input.apiKey, ...(input.secretValues ?? [])];
  if (containsSecret(model, secrets) || containsSecret(input.executable, secrets))
    throw new Error("Configuração do Kiro inválida.");
  if (input.sources.length > maxSources) throw new Error("O contexto de triagem excede o limite.");
  const paths = new Set<string>();
  let contextBytes = 0;
  const sources = input.sources.map(({ path, text }, index) => {
    if (
      !sourcePathSchema.safeParse(path).success ||
      paths.has(path) ||
      text.includes("\0") ||
      containsSecret(text, secrets) ||
      containsSecret(path, secrets)
    ) {
      throw new Error("Fonte de triagem inválida.");
    }
    paths.add(path);
    contextBytes += Buffer.byteLength(text);
    if (contextBytes > maxContextBytes) throw new Error("O contexto de triagem excede o limite.");
    return {
      path,
      readPath: `context/${index + 1}.txt`,
      text,
      sha256: createHash("sha256").update(text, "utf8").digest("hex"),
      lineCount:
        text.length === 0 ? 0 : text.replace(/(?:\r\n|\r|\n)$/u, "").split(/\r\n|\r|\n/u).length,
    };
  });
  const reportPath = `.resolva/reports/${identity.executionId}/triage-0.json`;
  const prompt = buildTriagePrompt(identity, input.ticket, sources, reportPath);
  const stdin = prompt.replaceAll("@", "\\u0040");
  if (containsSecret(prompt, secrets) || contextBytes + Buffer.byteLength(stdin) > maxContextBytes)
    throw new Error("O contexto de triagem é inválido ou excede o limite.");

  const root = await mkdtemp(join(await realpath(tmpdir()), "resolva-triage-"));
  try {
    const cwd = join(root, "workspace");
    const home = join(root, "home");
    const absoluteReport = join(cwd, reportPath);
    const agentDirectory = join(cwd, ".kiro", "agents");
    await mkdir(home, { mode: 0o700 });
    await mkdir(agentDirectory, { recursive: true, mode: 0o700 });
    await mkdir(dirname(absoluteReport), { recursive: true, mode: 0o700 });
    const profile = buildTriageProfile(
      sources.map(({ readPath }) => readPath),
      reportPath,
    );
    await writeFile(join(agentDirectory, `${triageAgentName}.json`), JSON.stringify(profile), {
      flag: "wx",
      mode: 0o600,
    });
    for (const { readPath, text } of sources) {
      const file = join(cwd, readPath);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, text, { flag: "wx", mode: 0o400 });
    }
    const command: KiroCommand = {
      executable: input.executable,
      args: [
        "chat",
        "--v3",
        "--no-interactive",
        "--output-format",
        "stream-json",
        "--agent",
        triageAgentName,
        `--model=${model}`,
        "--trust-workspace",
      ],
      cwd,
      shell: false,
      env: {
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_DATA_HOME: join(home, ".local", "share"),
        KIRO_API_KEY: input.apiKey,
      },
      stdin,
      timeoutMs,
      maxOutputBytes: 10 * 1024 * 1024,
    };
    let exitCode: number | null;
    try {
      ({ exitCode } = await execute(command));
    } catch {
      throw new Error("O processo de triagem do Kiro falhou.");
    }
    if (exitCode !== 0) throw new Error("O processo de triagem do Kiro falhou.");
    return await readTriageReport(absoluteReport, identity, sources, secrets);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
