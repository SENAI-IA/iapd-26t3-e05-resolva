import { implementationsRouter } from "./routers/implementations.js";
import { router } from "./core.js";
import { ticketsRouter } from "./routers/tickets.js";
import { triagesRouter } from "./routers/triages.js";

export const appRouter = router({
  tickets: ticketsRouter,
  triages: triagesRouter,
  implementations: implementationsRouter,
});
export type AppRouter = typeof appRouter;
