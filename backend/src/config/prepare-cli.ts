import { access, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const target = resolve(root, "resolva.config.json");
const example = resolve(root, "config/resolva.config.example.json");

try {
  await access(target, constants.F_OK);
  console.info("Configuração local do sistema-alvo já existe.");
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  await copyFile(example, target);
  console.info("Configuração local criada em resolva.config.json.");
}
