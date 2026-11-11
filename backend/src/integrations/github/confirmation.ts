import { z } from "zod";
import {
  githubBranchSchema,
  githubNumberSchema,
  githubRepositorySchema,
  gitShaSchema,
  sameRepository,
} from "./contracts.js";
import type { createGithubInspection } from "./inspection.js";

const confirmationSchema = z.strictObject({
  repository: githubRepositorySchema,
  deliveryId: z.uuid().transform((value) => value.toLowerCase()),
  branch: githubBranchSchema,
  baseBranch: githubBranchSchema,
  validatedSha: gitShaSchema,
  prNumber: githubNumberSchema,
});
export type DeliveryConfirmationInput = z.input<typeof confirmationSchema>;
type DeliveryReader = Pick<
  ReturnType<typeof createGithubInspection>,
  "getPullRequest" | "getBranchHead"
>;

export class DeliveryConfirmationError extends Error {
  constructor(public readonly reason: "remote_conflict" | "not_reviewable") {
    super(
      reason === "not_reviewable"
        ? "A Pull Request não está aberta e pronta para revisão."
        : "A Pull Request ou a branch remota diverge da entrega validada.",
    );
    this.name = "DeliveryConfirmationError";
  }
}

export async function confirmDelivery(input: DeliveryConfirmationInput, github: DeliveryReader) {
  const expected = confirmationSchema.parse(input);
  const pr = await github.getPullRequest({
    repository: expected.repository,
    number: expected.prNumber,
  });
  const markers = [...pr.body.matchAll(/<!--\s*resolva-delivery:([\s\S]*?)-->/gu)];
  if (
    !sameRepository(pr.headRepository, expected.repository) ||
    !sameRepository(pr.baseRepository, expected.repository) ||
    pr.headRefName !== expected.branch ||
    pr.baseRefName !== expected.baseBranch ||
    pr.headSha !== expected.validatedSha ||
    markers.length !== 1 ||
    markers[0]?.[1]?.trim().toLowerCase() !== expected.deliveryId
  )
    throw new DeliveryConfirmationError("remote_conflict");
  if (pr.state !== "OPEN" || pr.draft) throw new DeliveryConfirmationError("not_reviewable");
  const remoteHeadSha = await github.getBranchHead({
    repository: expected.repository,
    branch: expected.branch,
  });
  if (remoteHeadSha !== expected.validatedSha)
    throw new DeliveryConfirmationError("remote_conflict");
  return {
    deliveryId: expected.deliveryId,
    repository: expected.repository,
    branchName: expected.branch,
    baseBranch: expected.baseBranch,
    validatedSha: expected.validatedSha,
    remoteHeadSha,
    prNumber: pr.number,
    prUrl: pr.url,
    prState: pr.state,
  };
}
