import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createGithubClient, GithubCliError, type GhExecution } from "./cli.js";
import { reportZip } from "../../test/archive.js";

const input = {
  repository: "equipe/alvo",
  executionId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  workflowId: "12345",
  workflowAttempt: 2,
};
const name = "resolva-report-f47ac10b-58cc-4372-a567-0e02b2c3d479-2";
const sha256 = (archive: Buffer) => createHash("sha256").update(archive).digest("hex");
function metadata(archive: Buffer) {
  return {
    total_count: 1,
    artifacts: [
      {
        id: 6789,
        name,
        expired: false,
        size_in_bytes: archive.length,
        digest: `sha256:${sha256(archive)}`,
        workflow_run: { id: 12345 },
        archive_download_url: "https://untrusted.invalid/private/token",
      },
    ],
  };
}
function clientFor(archive: Buffer, response: unknown = metadata(archive)) {
  const execute = vi.fn<GhExecution>(async () => ({
    stdout: JSON.stringify(response),
    stderr: "",
  }));
  const executeBinary = vi.fn(async () => ({ stdout: archive, stderr: "" }));
  const client = createGithubClient({
    execute,
    executeBinary,
    token: "fixture-secret",
    cwd: "/fixture",
    timeoutMs: 5000,
  });
  return { client, execute, executeBinary };
}

describe("downloadPipelineReport", () => {
  it("downloads the fixed authenticated endpoint and verifies the digest before reading JSON", async () => {
    const archive = await reportZip();
    const { client, execute, executeBinary } = clientFor(archive);
    await expect(client.downloadPipelineReport(input)).resolves.toEqual({
      artifactId: "6789",
      archiveSha256: sha256(archive),
      content: Buffer.from('{"version":1}'),
    });
    const options = { token: "fixture-secret", cwd: "/fixture", timeoutMs: 5000 };
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        `repos/equipe/alvo/actions/runs/12345/artifacts?name=${name}&per_page=100`,
      ],
      options,
    );
    expect(executeBinary).toHaveBeenCalledExactlyOnceWith(
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        "repos/equipe/alvo/actions/artifacts/6789/zip",
      ],
      options,
    );
  });

  it("returns null for an absent artifact without downloading", async () => {
    const { client, executeBinary } = clientFor(await reportZip(), {
      total_count: 0,
      artifacts: [],
    });
    await expect(client.downloadPipelineReport(input)).resolves.toBeNull();
    expect(executeBinary).not.toHaveBeenCalled();
  });

  it.each([
    { repository: "https://github.com/equipe/alvo" },
    { repository: "equipe/alvo\n" },
    { executionId: "../report" },
    { executionId: "" },
    { workflowId: "1/../../secrets" },
    { workflowId: "01" },
    { workflowAttempt: 0 },
    { workflowAttempt: 1.5 },
    { workflowAttempt: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects unsafe input before any invocation: %j", async (change) => {
    const { client, execute, executeBinary } = clientFor(await reportZip());
    await expect(client.downloadPipelineReport({ ...input, ...change })).rejects.toBeDefined();
    expect(execute).not.toHaveBeenCalled();
    expect(executeBinary).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", { expired: true }],
    ["different run", { workflow_run: { id: 999 } }],
    ["wrong name", { name: "other" }],
    ["unsafe ID", { id: Number.MAX_SAFE_INTEGER + 1 }],
    ["empty ID", { id: 0 }],
    ["missing digest", { digest: undefined }],
    ["uppercase digest", { digest: `sha256:${"A".repeat(64)}` }],
    ["empty size", { size_in_bytes: 0 }],
    ["large size", { size_in_bytes: 262145 }],
  ])("rejects %s metadata before downloading", async (_label, change) => {
    const archive = await reportZip();
    const response = metadata(archive);
    Object.assign(response.artifacts[0]!, change);
    const { client, executeBinary } = clientFor(archive, response);
    await expect(client.downloadPipelineReport(input)).rejects.toMatchObject({
      reason: "invalid_response",
    });
    expect(executeBinary).not.toHaveBeenCalled();
  });

  it.each([
    { total_count: 2 },
    { total_count: 0 },
    { total_count: 1, artifacts: [] },
    { total_count: 101 },
    { total_count: -1 },
    { total_count: "1" },
  ])("rejects incomplete or ambiguous lists: %j", async (change) => {
    const archive = await reportZip();
    const { client, executeBinary } = clientFor(archive, { ...metadata(archive), ...change });
    await expect(client.downloadPipelineReport(input)).rejects.toMatchObject({
      reason: "invalid_response",
    });
    expect(executeBinary).not.toHaveBeenCalled();
  });

  it("rejects duplicate artifacts", async () => {
    const archive = await reportZip();
    const response = metadata(archive);
    response.artifacts.push(response.artifacts[0]!);
    response.total_count = 2;
    const { client } = clientFor(archive, response);
    await expect(client.downloadPipelineReport(input)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  it("rejects a digest mismatch", async () => {
    const archive = await reportZip();
    const response = metadata(archive);
    response.artifacts[0]!.digest = `sha256:${"0".repeat(64)}`;
    await expect(
      clientFor(archive, response).client.downloadPipelineReport(input),
    ).rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("rejects oversized binary output even when metadata and digest look valid", async () => {
    const archive = Buffer.alloc(262145);
    const response = metadata(archive);
    response.artifacts[0]!.size_in_bytes = 100;
    await expect(
      clientFor(archive, response).client.downloadPipelineReport(input),
    ).rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("rejects a binary whose length diverges from authenticated metadata", async () => {
    const archive = await reportZip();
    const response = metadata(archive);
    response.artifacts[0]!.size_in_bytes = archive.length + 1;
    await expect(
      clientFor(archive, response).client.downloadPipelineReport(input),
    ).rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("fails closed when only a text executor was injected", async () => {
    const archive = await reportZip();
    const execute = vi.fn<GhExecution>(async () => ({
      stdout: JSON.stringify(metadata(archive)),
      stderr: "",
    }));
    await expect(
      createGithubClient({ execute }).downloadPipelineReport(input),
    ).rejects.toMatchObject({ reason: "failed" });
  });

  it.each(["failed", "timeout", "unavailable"] as const)(
    "sanitizes %s transport errors",
    async (reason) => {
      const { client, executeBinary } = clientFor(await reportZip());
      executeBinary.mockRejectedValue(
        new GithubCliError(reason, "/remote/path secret body stderr"),
      );
      const error = await client.downloadPipelineReport(input).catch((error: unknown) => error);
      expect(error).toMatchObject({ reason });
      expect(String(error)).not.toMatch(/remote|secret|stderr/);
    },
  );

  it("sanitizes invalid JSON and raw transport failures", async () => {
    const { client, execute } = clientFor(await reportZip());
    execute.mockResolvedValueOnce({ stdout: "secret malformed", stderr: "/private/path" });
    await expect(client.downloadPipelineReport(input)).rejects.toMatchObject({
      reason: "invalid_response",
    });
    execute.mockRejectedValueOnce(new Error("secret raw error"));
    const error = await client.downloadPipelineReport(input).catch((error: unknown) => error);
    expect(error).toMatchObject({ reason: "failed" });
    expect(String(error)).not.toMatch(/secret/);
  });
});

describe("isolated binary gh process", () => {
  it("preserves ZIP bytes and exposes only the explicit environment to gh", async () => {
    const directory = await mkdtemp(join(tmpdir(), "resolva-gh-fixture-"));
    const oldPath = process.env.PATH;
    const oldToken = process.env.GH_TOKEN;
    const oldPoison = process.env.RESOLVA_FIXTURE_POISON;
    try {
      const archive = await reportZip();
      const response = metadata(archive);
      const script = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync('calls.jsonl', JSON.stringify({args, env:process.env, cwd:process.cwd()})+'\\n');
if (args.at(-1).endsWith('/zip')) process.stdout.write(Buffer.from(${JSON.stringify(archive.toString("base64"))}, 'base64'));
else process.stdout.write(${JSON.stringify(JSON.stringify(response))});
`;
      await writeFile(join(directory, "gh"), script, { mode: 0o700 });
      // A package marker lets the local executable use ESM on every host.
      await writeFile(join(directory, "package.json"), '{"type":"module"}');
      process.env.PATH = directory;
      process.env.GH_TOKEN = "inherited-token-must-not-leak";
      process.env.RESOLVA_FIXTURE_POISON = "must-not-leak";
      const client = createGithubClient({ cwd: directory, token: "explicit-token" });
      await expect(client.downloadPipelineReport(input)).resolves.toMatchObject({
        artifactId: "6789",
        content: Buffer.from('{"version":1}'),
      });
      const calls = (await readFile(join(directory, "calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as { args: string[]; env: Record<string, string>; cwd: string },
        );
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call.cwd).toBe(directory);
        expect(call.env.GH_TOKEN).toBe("explicit-token");
        expect(call.env.RESOLVA_FIXTURE_POISON).toBeUndefined();
        expect(call.args.join(" ")).not.toContain("token");
      }
      expect(calls[1]!.args).toEqual([
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        "repos/equipe/alvo/actions/artifacts/6789/zip",
      ]);
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldToken === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = oldToken;
      if (oldPoison === undefined) delete process.env.RESOLVA_FIXTURE_POISON;
      else process.env.RESOLVA_FIXTURE_POISON = oldPoison;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
