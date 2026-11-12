import { z } from "zod";
import { type GithubClient } from "../integrations/github/cli.js";
import { DeliveryConfirmationError } from "../integrations/github/confirmation.js";
import type { PipelineCallback } from "../integrations/ci/callback.js";
import { DomainError } from "../domain/error.js";
import type { ImplementationEnvironment } from "../domain/contracts.js";
import {
  implementationListInputSchema,
  implementationQueueInputSchema,
  type ImplementationListInput,
  type ImplementationQueueInput,
  type StartImplementationInput,
} from "../domain/implementationContracts.js";
import type { ImplementationRepository } from "../repository/implementationRepository.js";
import {
  assertWorkflowMatchesDispatch,
  assertEvidenceMatchesDispatch,
  type DispatchReconciliationInput,
} from "../domain/implementationDispatch.js";
import type { PipelineReportCollector } from "../integrations/ci/collectReport.js";
import type { ParsedPipelineReport } from "../integrations/ci/report.js";

const workflowConfigSchema = z.object({
  repository: z.string().min(1),
  workflowRef: z.string().min(1),
  baseBranch: z.string().min(1),
});

type RuntimeEnvironment = Pick<ImplementationEnvironment, "ready" | "sourceHashes">;
type RuntimeEnvironmentProvider =
  | RuntimeEnvironment
  | (() => RuntimeEnvironment | Promise<RuntimeEnvironment>);

export function createImplementationService(
  repository: ImplementationRepository,
  environment: RuntimeEnvironmentProvider,
  github?: GithubClient,
  reports?: PipelineReportCollector,
) {
  async function currentEnvironment() {
    return typeof environment === "function" ? await environment() : environment;
  }

  async function applyCallback(callback: PipelineCallback) {
    if (callback.status !== "success") return repository.applyPipelineCallback(callback);
    const proposal = await repository.registerSuccessProposal(callback);
    if (proposal.replay) return proposal.result;
    const context = await repository.prepareSuccessConfirmation(callback);
    if (context.replay) return context.result;
    if (!github)
      throw new DomainError(
        "PRECONDITION_FAILED",
        "Configure o GitHub para confirmar a entrega da implementação.",
      );
    let delivery;
    try {
      const workflow = await github.getWorkflowRun({
        repository: context.expected.repository,
        workflowId: callback.workflowId,
      });
      if (context.dispatch) assertWorkflowMatchesDispatch(context.dispatch, workflow);
      if (
        workflow.status !== "completed" ||
        workflow.conclusion !== "success" ||
        workflow.event !== "workflow_dispatch" ||
        workflow.attempt !== context.workflowAttempt ||
        workflow.workflowDefinitionId !== context.workflowDefinitionId ||
        workflow.headBranch !== context.expected.baseBranch
      )
        throw new DomainError("CONFLICT", "A workflow remota diverge da evidência aprovada.");
      delivery = await github.confirmDelivery(context.expected);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error instanceof DeliveryConfirmationError)
        throw new DomainError("CONFLICT", error.message);
      throw new DomainError(
        "PRECONDITION_FAILED",
        "Não foi possível confirmar a execução no GitHub. A implementação permanece ativa para reconciliação.",
      );
    }
    return repository.applyPipelineCallback(callback, {
      callbackFingerprint: context.callbackFingerprint,
      validationFingerprint: context.validationFingerprint,
      dispatchFingerprint: context.dispatch?.checkpointFingerprint ?? null,
      workflowId: callback.workflowId,
      workflowDefinitionId: context.workflowDefinitionId,
      workflowAttempt: context.workflowAttempt,
      delivery,
    });
  }

  async function assertGithubAvailability() {
    if (!github) return;
    try {
      const availability = await github.checkAvailability();
      if (!availability.installed)
        throw new DomainError(
          "PRECONDITION_FAILED",
          "Instale o GitHub CLI (gh) na máquina da aplicação.",
        );
      if (!availability.authenticated)
        throw new DomainError(
          "PRECONDITION_FAILED",
          "Autentique o GitHub CLI (gh) na máquina da aplicação.",
        );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("PRECONDITION_FAILED", "Não foi possível validar o GitHub CLI.");
    }
  }

  async function dispatchWorkflow(
    reservation: NonNullable<
      Awaited<ReturnType<ImplementationRepository["reserve"]>>["reservation"]
    >,
  ) {
    if (!github) return;
    const config = workflowConfigSchema.safeParse(reservation.configSnapshot);
    if (!config.success) {
      await repository.blockWorkflowDispatch(reservation.executionId);
      throw new DomainError(
        "PRECONDITION_FAILED",
        "A configuração da execução não pode disparar a workflow.",
      );
    }
    let workflowDefinitionId: string;
    try {
      await assertGithubAvailability();
      const definition = await github.getWorkflowDefinition({
        repository: config.data.repository,
        workflow: config.data.workflowRef,
      });
      if (definition.state !== "active")
        throw new DomainError(
          "PRECONDITION_FAILED",
          "A workflow configurada não está ativa no GitHub.",
        );
      const checkpoint = await repository.beginWorkflowDispatch(reservation.executionId, {
        id: definition.id,
        path: definition.path,
      });
      if (!checkpoint.applied) return;
      workflowDefinitionId = definition.id;
    } catch (error) {
      await repository.blockWorkflowDispatch(reservation.executionId);
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "PRECONDITION_FAILED",
        "Não foi possível validar a workflow antes do disparo.",
      );
    }
    try {
      await github.triggerWorkflow({
        repository: config.data.repository,
        workflow: workflowDefinitionId,
        ref: config.data.baseBranch,
        fields: {
          executionId: reservation.executionId,
          ticketId: String(reservation.ticketId),
          ticketVersion: String(reservation.ticketSnapshot.version),
          deliveryId: reservation.deliveryId,
          branchName: reservation.branchName,
        },
      });
      await repository.markWorkflowDispatched(reservation.executionId);
    } catch {
      const confirmation = await repository.markWorkflowDispatchUnconfirmed(
        reservation.executionId,
      );
      if (confirmation.workflowKnown) return;
      throw new DomainError(
        "PRECONDITION_FAILED",
        "A resposta do disparo não foi confirmada. A implementação permanece ativa para reconciliação.",
      );
    }
  }

  return {
    async environment() {
      const current = await currentEnvironment();
      return {
        ready: current.ready,
        sourceCount: Object.keys(current.sourceHashes).length,
      };
    },
    async queue(input?: ImplementationQueueInput) {
      const current = await currentEnvironment();
      return repository.queue(input ?? implementationQueueInputSchema.parse({}), current);
    },
    list(input?: ImplementationListInput) {
      return repository.list(input ?? implementationListInputSchema.parse({}));
    },
    byId(executionId: string) {
      return repository.byId(executionId);
    },
    applyCallback,
    async reconcile(executionId: string) {
      return applyCallback(await repository.pendingSuccessCallback(executionId));
    },
    async collectReport(executionId: string) {
      const state = await repository.prepareReportCollection(executionId);
      if (state.replay) return applyCallback(await repository.pendingSuccessCallback(executionId));
      if (!reports)
        throw new DomainError(
          "PRECONDITION_FAILED",
          "Configure a coleta dos relatórios da pipeline.",
        );
      let collected: ParsedPipelineReport;
      try {
        if (state.cached) {
          assertEvidenceMatchesDispatch(state.cached, state.dispatch);
          collected = await reports.readApproved(
            { ...state.context, workflowAttempt: state.cached.workflowAttempt },
            state.cached,
          );
        } else {
          if (!github)
            throw new DomainError(
              "PRECONDITION_FAILED",
              "Configure o GitHub para coletar o relatório da pipeline.",
            );
          const workflow = await github.getWorkflowRun({
            repository: state.context.repository,
            workflowId: state.context.workflowId,
          });
          assertWorkflowMatchesDispatch(state.dispatch, workflow);
          assertEvidenceMatchesDispatch(
            {
              workflowDefinitionId: workflow.workflowDefinitionId,
              workflowAttempt: workflow.attempt,
            },
            state.dispatch,
          );
          if (workflow.status !== "completed" || workflow.conclusion !== "success")
            throw new DomainError(
              "PRECONDITION_FAILED",
              "A workflow ainda não concluiu com sucesso para coletar evidências.",
            );
          collected = await reports.collect(
            { ...state.context, workflowAttempt: workflow.attempt },
            github,
          );
        }
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError(
          "PRECONDITION_FAILED",
          "O relatório da pipeline está indisponível ou inválido. A execução permanece ativa.",
        );
      }
      await repository.recordValidationEvidence(collected.evidence, state.fingerprint);
      return applyCallback(collected.callback);
    },
    async reconcileDispatch(input: DispatchReconciliationInput) {
      const state = await repository.prepareDispatchReconciliation(input);
      if (state.replay) return state.result;
      if (!github)
        throw new DomainError(
          "PRECONDITION_FAILED",
          "Configure o GitHub para reconciliar o disparo.",
        );
      let run;
      try {
        run = await github.getWorkflowRun({
          repository: state.context.repository,
          workflowId: input.workflowId,
        });
      } catch {
        throw new DomainError(
          "PRECONDITION_FAILED",
          "Não foi possível consultar a workflow no GitHub. A execução permanece ativa para reconciliação.",
        );
      }
      return repository.applyDispatchObservation(input, state.context.checkpointFingerprint, run);
    },
    async start(input: StartImplementationInput) {
      const current = await currentEnvironment();
      const { id, reservation } = await repository.reserve(input, current);
      if (reservation) await dispatchWorkflow(reservation);
      return { implementationExecutionId: id };
    },
  };
}

export type ImplementationService = ReturnType<typeof createImplementationService>;
