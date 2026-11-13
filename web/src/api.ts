import type {
  ListTicketsInput,
  Ticket,
  TicketContent,
  TicketDetails,
  TicketEvents,
  TicketList,
} from "../../backend/src/domain/contracts.js";
import type {
  ImplementationArtifactResult,
  ImplementationCallbackResult,
  ImplementationDetail,
  ImplementationEvents,
  ImplementationListInput,
  ImplementationListResult,
  ImplementationQueueInput,
  ImplementationQueueResult,
  EnvironmentCheck,
  PublicEnvironment,
  StartImplementationResult,
} from "../../backend/src/domain/implementationContracts.js";
import type { DispatchReconciliationResult } from "../../backend/src/domain/implementationDispatch.js";
import type {
  StartTriageInput,
  TriageDetail,
  TriageEvents,
  TriageListResult,
} from "../../backend/src/domain/triageContracts.js";

type ApiResponse<T> = {
  result?: { data?: T };
  error?: { message?: string };
};

type StartTriageResult = { triageExecutionId: string };

async function call<T>(procedure: string, input?: unknown, mutation = false): Promise<T> {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await fetch(`/trpc/${procedure}${mutation ? "" : query}`, {
    method: mutation ? "POST" : "GET",
    ...(mutation
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(input) }
      : {}),
  });
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || body.result?.data === undefined) {
    throw new Error(body.error?.message ?? "Não foi possível concluir a solicitação.");
  }
  return body.result.data;
}

export function listTickets(
  input: ListTicketsInput = { page: 1, pageSize: 15 },
): Promise<TicketList> {
  return call<TicketList>("tickets.list", input);
}

export function getTicket(ticketId: number): Promise<TicketDetails> {
  return call<TicketDetails>("tickets.byId", { ticketId });
}

export function getTicketEvents(ticketId: number): Promise<TicketEvents> {
  return call<TicketEvents>("tickets.events", { ticketId, page: 1, pageSize: 50 });
}

export function getTriage(triageId: string): Promise<TriageDetail> {
  return call<TriageDetail>("triages.byId", { triageId });
}

export function getTriageEvents(triageId: string, afterSequence = 0): Promise<TriageEvents> {
  return call<TriageEvents>("triages.events", {
    triageId,
    afterSequence,
    limit: 100,
  });
}

export function createTicket(input: TicketContent): Promise<Ticket> {
  return call<Ticket>("tickets.create", input, true);
}

export function updateTicket(
  input: TicketContent & {
    ticketId: number;
    expectedVersion: number;
  },
): Promise<Ticket> {
  return call<Ticket>("tickets.update", input, true);
}

export function provideTicketInformation(input: {
  ticketId: number;
  expectedVersion: number;
  message: string;
}): Promise<Ticket> {
  return call<Ticket>("tickets.provideInformation", input, true);
}

export function contestTriage(input: {
  ticketId: number;
  expectedVersion: number;
  message: string;
}): Promise<Ticket> {
  return call<Ticket>("tickets.contestTriage", input, true);
}

export function requestTicketChanges(input: {
  ticketId: number;
  expectedVersion: number;
  kind: "behavior" | "refinement";
  message: string;
}): Promise<Ticket> {
  return call<Ticket>("tickets.requestChanges", input, true);
}

export function resolveTicket(input: {
  ticketId: number;
  expectedVersion: number;
  mergeConfirmed: true;
  testVerified: true;
  message?: string;
}): Promise<Ticket> {
  return call<Ticket>("tickets.resolve", input, true);
}

export function reopenTicket(input: {
  ticketId: number;
  expectedVersion: number;
  message: string;
}): Promise<Ticket> {
  return call<Ticket>("tickets.reopen", input, true);
}

export function startTriage(input: StartTriageInput): Promise<StartTriageResult> {
  return call<StartTriageResult>("triages.start", input, true);
}

export function listTriages(ticketId: number): Promise<TriageListResult> {
  return call<TriageListResult>("triages.list", {
    ticketId,
    page: 1,
    pageSize: 50,
  });
}

export function getImplementation(executionId: string): Promise<ImplementationDetail> {
  return call<ImplementationDetail>("executions.byId", { executionId });
}

export function getImplementationEvents(
  executionId: string,
  afterSequence = 0,
): Promise<ImplementationEvents> {
  return call<ImplementationEvents>("executions.events", {
    executionId,
    afterSequence,
    limit: 100,
  });
}

export function getImplementationArtifact(
  executionId: string,
  artifactId: string,
): Promise<ImplementationArtifactResult> {
  return call<ImplementationArtifactResult>("executions.artifact", {
    executionId,
    artifactId,
  });
}

export function reconcileDispatch(input: {
  executionId: string;
  workflowId: string;
}): Promise<DispatchReconciliationResult> {
  return call<DispatchReconciliationResult>("implementations.reconcileDispatch", input, true);
}

export function collectImplementationReport(
  executionId: string,
): Promise<ImplementationCallbackResult> {
  return call<ImplementationCallbackResult>("implementations.collectReport", { executionId }, true);
}

export function getImplementationEnvironment(): Promise<PublicEnvironment> {
  return call<PublicEnvironment>("environment.get");
}

export function checkImplementationEnvironment(): Promise<EnvironmentCheck> {
  return call<EnvironmentCheck>("environment.check");
}

export function listImplementations(
  input: ImplementationListInput = { page: 1, pageSize: 20 },
): Promise<ImplementationListResult> {
  return call<ImplementationListResult>("executions.list", input);
}

export function listImplementationQueue(
  input: ImplementationQueueInput = { page: 1, pageSize: 20 },
): Promise<ImplementationQueueResult> {
  return call<ImplementationQueueResult>("implementations.queue", input);
}

export function retryImplementation(input: {
  executionId: string;
  requestKey: string;
}): Promise<StartImplementationResult> {
  return call<StartImplementationResult>("implementations.retry", input, true);
}

export function startImplementation(input: {
  ticketId: number;
  expectedVersion: number;
  requestKey: string;
}): Promise<StartImplementationResult> {
  return call<StartImplementationResult>("implementations.start", input, true);
}
