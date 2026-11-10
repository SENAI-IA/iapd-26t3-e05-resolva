import { initTRPC, TRPCError } from "@trpc/server";
import { DomainError } from "../domain/error.js";
import type { TicketService } from "../services/ticketService.js";
import type { TriageService } from "../services/triageService.js";
import type { ImplementationService } from "../services/implementationService.js";

export interface TRPCContext {
  tickets: TicketService | null;
  triages: TriageService | null;
  implementations: ImplementationService | null;
}

const publicMessages: Record<string, string> = {
  BAD_REQUEST: "Dados da solicitação inválidos.",
  NOT_FOUND: "Recurso não encontrado.",
  CONFLICT: "Os dados foram alterados. Atualize antes de tentar novamente.",
  PRECONDITION_FAILED: "Configure o banco de dados para utilizar este recurso.",
  METHOD_NOT_SUPPORTED: "Método não permitido para esta operação.",
};

const trpc = initTRPC.context<TRPCContext>().create({
  errorFormatter({ shape, error }) {
    return {
      code: shape.code,
      message:
        error.cause instanceof DomainError
          ? error.cause.message
          : (publicMessages[shape.data.code] ?? "Não foi possível concluir a solicitação."),
      data: {
        code: shape.data.code,
        httpStatus: shape.data.httpStatus,
        ...(error.cause instanceof DomainError && error.cause.activeExecutionId
          ? { activeExecutionId: error.cause.activeExecutionId }
          : {}),
      },
    };
  },
});

export const router = trpc.router;
const procedure = trpc.procedure.use(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof DomainError) {
    throw new TRPCError({ code: result.error.cause.code, cause: result.error.cause });
  }
  return result;
});

export const ticketProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.tickets) throw new TRPCError({ code: "PRECONDITION_FAILED" });
  return next({ ctx: { tickets: ctx.tickets } });
});

export const triageProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.triages) throw new TRPCError({ code: "PRECONDITION_FAILED" });
  return next({ ctx: { triages: ctx.triages } });
});

export const implementationProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.implementations) throw new TRPCError({ code: "PRECONDITION_FAILED" });
  return next({ ctx: { implementations: ctx.implementations } });
});
