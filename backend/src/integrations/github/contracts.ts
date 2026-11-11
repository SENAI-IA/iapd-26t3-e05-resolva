import { z } from "zod";
import { hasControlCharacters } from "../../config/strings.js";

export const githubRepositorySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u);
export const githubBranchSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !hasControlCharacters(value) &&
      !/\s/u.test(value) &&
      !["~", "^", ":", "?", "*", "["].some((character) => value.includes(character)) &&
      !value.includes("\\") &&
      !value.includes(".."),
  );
export const githubRunIdSchema = z
  .string()
  .max(200)
  .regex(/^[1-9][0-9]*$/u);
export const gitShaSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
export const githubNumberSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export function sameRepository(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}
