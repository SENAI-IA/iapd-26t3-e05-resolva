import {
  listTicketsSchema,
  messageTicketSchema,
  requestChangesSchema,
  resolveTicketSchema,
  ticketContentSchema,
  ticketDetailsSchema,
  ticketEventsInputSchema,
  ticketEventsSchema,
  ticketIdentitySchema,
  ticketListSchema,
  ticketSchema,
  updateTicketSchema,
} from "../../domain/contracts.js";
import { router, ticketProcedure } from "../core.js";

export const ticketsRouter = router({
  create: ticketProcedure
    .input(ticketContentSchema)
    .output(ticketSchema)
    .mutation(({ ctx, input }) => ctx.tickets.create(input)),
  list: ticketProcedure
    .input(listTicketsSchema.optional())
    .output(ticketListSchema)
    .query(({ ctx, input }) => ctx.tickets.list(input)),
  byId: ticketProcedure
    .input(ticketIdentitySchema)
    .output(ticketDetailsSchema)
    .query(({ ctx, input }) => ctx.tickets.byId(input)),
  update: ticketProcedure
    .input(updateTicketSchema)
    .output(ticketSchema)
    .mutation(({ ctx, input }) => ctx.tickets.update(input)),
  events: ticketProcedure
    .input(ticketEventsInputSchema)
    .output(ticketEventsSchema)
    .query(({ ctx, input }) => ctx.tickets.events(input)),
  provideInformation: ticketProcedure
    .input(messageTicketSchema)
    .output(ticketSchema)
    .mutation(({ ctx, input }) => ctx.tickets.provideInformation(input)),
  contestTriage: ticketProcedure
    .input(messageTicketSchema)
    .output(ticketSchema)
    .mutation(({ ctx, input }) => ctx.tickets.contestTriage(input)),
  requestChanges: ticketProcedure
    .input(requestChangesSchema)
    .output(ticketSchema)
    .mutation(({ ctx, input }) => ctx.tickets.requestChanges(input)),
  resolve: ticketProcedure
    .input(resolveTicketSchema)
    .output(ticketSchema)
    .mutation(({ ctx, input }) => ctx.tickets.resolve(input)),
  reopen: ticketProcedure
    .input(messageTicketSchema)
    .output(ticketSchema)
    .mutation(({ ctx, input }) => ctx.tickets.reopen(input)),
});
