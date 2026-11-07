import { z } from "zod";
import { ConfigurationError } from "./error.js";
import { hasControlCharacters } from "./strings.js";

const optionalValue = (schema: z.ZodType<string>) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const environmentSchema = z.object({
  DATABASE_URL: optionalValue(
    z.url().refine((value) => {
      try {
        const url = new URL(value);
        return (
          ["postgres:", "postgresql:"].includes(url.protocol) &&
          url.hostname !== "" &&
          url.pathname.length > 1
        );
      } catch {
        return false;
      }
    }),
  ),
  GH_TOKEN: optionalValue(z.string().min(1)),
  KIRO_API_KEY: optionalValue(z.string().min(1)),
  RESOLVA_CONFIG_PATH: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .min(1)
      .refine((value) => !hasControlCharacters(value))
      .default("resolva.config.json"),
  ),
});

export type Environment = z.infer<typeof environmentSchema>;

export function readEnvironment(source: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) throw new ConfigurationError("Configuração de ambiente inválida.");
  return result.data;
}
