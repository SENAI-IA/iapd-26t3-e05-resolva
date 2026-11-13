import { z } from "zod";
import {
  environmentCheckSchema,
  publicEnvironmentSchema,
} from "../../domain/implementationContracts.js";
import { implementationProcedure, router } from "../core.js";

export const environmentRouter = router({
  get: implementationProcedure
    .input(z.undefined().optional())
    .output(publicEnvironmentSchema)
    .query(({ ctx }) => ctx.implementations.environment()),
  check: implementationProcedure
    .input(z.undefined().optional())
    .output(environmentCheckSchema)
    .query(({ ctx }) => ctx.implementations.environmentCheck()),
});
