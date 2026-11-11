import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { triageSourcePathSchema } from "../../domain/contracts.js";
import type { ImplementationEvidence } from "../../domain/implementationEvidence.js";
import { createReportStore, type ReportStore } from "../../executor/reportStore.js";
import type { GithubClient } from "../github/cli.js";
import { parsePipelineReport, type PipelineReportContext } from "./report.js";

type Context = PipelineReportContext & { artifactRoot: string };
export function createPipelineReportCollector(options: {
  applicationRoot: string;
  secretValues?: readonly string[];
}) {
  const stores = new Map<string, ReportStore>();
  async function storeFor(context: Context) {
    let path = await realpath(options.applicationRoot);
    for (const segment of triageSourcePathSchema.parse(context.artifactRoot).split("/")) {
      path = join(path, segment);
      try {
        await mkdir(path, { mode: 0o700 });
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("A raiz dos relatórios é inválida.");
    }
    let store = stores.get(path);
    if (!store) {
      store = createReportStore(path);
      stores.set(path, store);
    }
    return store;
  }
  return {
    async collect(context: Context, github: GithubClient) {
      const download = await github.downloadPipelineReport({
        repository: context.repository,
        executionId: context.executionId,
        workflowId: context.workflowId,
        workflowAttempt: context.workflowAttempt,
      });
      if (!download) throw new Error("O relatório da pipeline ainda não está disponível.");
      const parsed = parsePipelineReport(download.content, context, options.secretValues ?? [], {
        artifactId: download.artifactId,
        archiveSha256: download.archiveSha256,
      });
      const stored = await (await storeFor(context)).persist(context.executionId, parsed.content);
      if (
        stored.sha256 !== parsed.evidence.report.sha256 ||
        stored.relativePath !== parsed.evidence.report.relativePath ||
        stored.sizeBytes !== parsed.evidence.report.sizeBytes
      )
        throw new Error("O relatório persistido diverge da evidência coletada.");
      return parsed;
    },
    async readApproved(context: Context, evidence: ImplementationEvidence) {
      const content = await (await storeFor(context)).read(context.executionId, evidence.report);
      const parsed = parsePipelineReport(content, context, options.secretValues ?? []);
      if (parsed.evidence.report.sha256 !== evidence.report.sha256)
        throw new Error("O relatório aprovado foi alterado.");
      return parsed;
    },
  };
}
export type PipelineReportCollector = ReturnType<typeof createPipelineReportCollector>;
