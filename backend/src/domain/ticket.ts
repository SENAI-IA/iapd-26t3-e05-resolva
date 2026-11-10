import type {
  ImplementationEnvironment,
  ImplementationTicket,
  ImplementationTriage,
  TicketStatus,
} from "./contracts.js";
import { DomainError } from "./error.js";
import { canStartImplementation, classifyTriage } from "./triage.js";

export type TicketAction =
  | { type: "edit" | "provide_information" | "contest_triage" | "reopen" | "analyze" }
  | { type: "complete_triage"; evidence: unknown }
  | {
      type: "start_implementation";
      ticket: ImplementationTicket;
      triage: ImplementationTriage | null;
      environment: ImplementationEnvironment;
    }
  | { type: "resolve"; mergeConfirmed: boolean; testVerified: boolean };

export function transitionTicket(current: TicketStatus, action: TicketAction): TicketStatus {
  switch (action.type) {
    case "analyze":
      if (
        current === "aberto" ||
        current === "aguardando_informacoes" ||
        current === "aguardando_implementacao"
      )
        return "em_triagem";
      break;
    case "complete_triage":
      if (current === "em_triagem") return classifyTriage(action.evidence).status;
      break;
    case "start_implementation": {
      if (current !== action.ticket.status || current !== "aguardando_implementacao") break;
      const eligibility = canStartImplementation(action.ticket, action.triage, action.environment);
      if (eligibility.eligible) return "em_andamento";
      throw new DomainError(
        eligibility.code === "PRECONDITION_FAILED" ? "PRECONDITION_FAILED" : "CONFLICT",
        eligibility.message,
      );
    }
    case "edit":
      if (current === "aberto" || current === "aguardando_informacoes") return current;
      break;
    case "provide_information":
      if (current === "aguardando_informacoes") return "aberto";
      break;
    case "contest_triage":
      if (current === "recusado") return "aberto";
      break;
    case "reopen":
      if (current === "resolvido") return "aberto";
      break;
    case "resolve":
      if (current === "aguardando_revisao" && action.mergeConfirmed && action.testVerified)
        return "resolvido";
      break;
  }
  throw new DomainError("CONFLICT", "A ação não é permitida no estado atual do ticket.");
}
