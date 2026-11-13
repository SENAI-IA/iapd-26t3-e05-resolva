import { z } from "zod";
import { createTargetSystemSnapshot, type TargetSystemConfig } from "../config/project.js";
import {
  defaultCategories,
  listTicketsSchema,
  messageTicketSchema,
  requestChangesSchema,
  resolveTicketSchema,
  ticketContentSchema,
  ticketEventsInputSchema,
  ticketIdentitySchema,
  updateTicketSchema,
} from "../domain/contracts.js";
import { DomainError } from "../domain/error.js";
import type { TicketRepository } from "../repository/ticketRepository.js";

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new DomainError("BAD_REQUEST", "Dados do ticket inválidos.");
  return result.data;
}

export function createTicketService(
  repository: TicketRepository,
  categories: readonly string[] = defaultCategories.map((category) => category.slug),
  targetConfig?: TargetSystemConfig,
) {
  const allowedCategories = new Set(categories);
  function validateCategory(category: string) {
    if (!allowedCategories.has(category))
      throw new DomainError("BAD_REQUEST", "Categoria não permitida na configuração atual.");
  }
  function snapshotFor(key: string) {
    if (!targetConfig)
      throw new DomainError(
        "PRECONDITION_FAILED",
        "Configure e valide o sistema-alvo antes de cadastrar tickets.",
      );
    if (key !== targetConfig.targetSystemKey)
      throw new DomainError("BAD_REQUEST", "Sistema-alvo não disponível na configuração atual.");
    return createTargetSystemSnapshot(targetConfig);
  }
  return {
    async create(input: unknown) {
      const content = validate(ticketContentSchema, input);
      validateCategory(content.category);
      return repository.create(content, snapshotFor(content.targetSystemKey));
    },
    async list(input: unknown = {}) {
      return repository.list(validate(listTicketsSchema, input));
    },
    async byId(input: unknown) {
      return repository.byId(validate(ticketIdentitySchema, input).ticketId);
    },
    async update(input: unknown) {
      const { ticketId, expectedVersion, ...content } = validate(updateTicketSchema, input);
      validateCategory(content.category);
      return repository.mutate({
        ticketId,
        expectedVersion,
        type: "edit",
        content,
        targetConfigSnapshot: snapshotFor(content.targetSystemKey),
      });
    },
    async events(input: unknown) {
      return repository.events(validate(ticketEventsInputSchema, input));
    },
    async provideInformation(input: unknown) {
      return repository.mutate({
        ...validate(messageTicketSchema, input),
        type: "provide_information",
      });
    },
    async contestTriage(input: unknown) {
      return repository.mutate({ ...validate(messageTicketSchema, input), type: "contest_triage" });
    },
    async requestChanges(input: unknown) {
      return repository.mutate({
        ...validate(requestChangesSchema, input),
        type: "request_changes",
      });
    },
    async resolve(input: unknown) {
      return repository.mutate({ ...validate(resolveTicketSchema, input), type: "resolve" });
    },
    async reopen(input: unknown) {
      return repository.mutate({ ...validate(messageTicketSchema, input), type: "reopen" });
    },
  };
}
export type TicketService = ReturnType<typeof createTicketService>;
