import { z } from "zod";

const messageEventSchema = z.strictObject({
  type: z.literal("message"),
  message: z.string().min(1).max(10000),
});
const toolEventSchema = z.strictObject({
  type: z.literal("tool"),
  name: z.string().min(1).max(200),
  status: z.enum(["started", "completed"]),
});
const warningEventSchema = z.strictObject({
  type: z.literal("warning"),
  message: z.string().min(1).max(10000),
});
const eventTypeSchema = z.object({ type: z.string() });

export type KiroPublicEvent =
  | { kind: "message"; message: string }
  | { kind: "tool"; name: string; status: "started" | "completed" }
  | { kind: "warning"; message: string };

export class KiroEventError extends Error {
  constructor(message = "Evento JSONL do Kiro inválido.") {
    super(message);
    this.name = "KiroEventError";
  }
}

function parsePublicEvent(raw: string): KiroPublicEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new KiroEventError();
  }
  const type = eventTypeSchema.safeParse(value);
  if (!type.success) return null;
  if (type.data.type === "message") {
    const event = messageEventSchema.safeParse(value);
    if (!event.success) throw new KiroEventError();
    return { kind: "message", message: event.data.message };
  }
  if (type.data.type === "tool") {
    const event = toolEventSchema.safeParse(value);
    if (!event.success) throw new KiroEventError();
    return { kind: "tool", name: event.data.name, status: event.data.status };
  }
  if (type.data.type === "warning") {
    const event = warningEventSchema.safeParse(value);
    if (!event.success) throw new KiroEventError();
    return { kind: "warning", message: event.data.message };
  }
  return null;
}

export class KiroJsonlDecoder {
  private buffer = "";

  feed(chunk: string): KiroPublicEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/u);
    this.buffer = lines.pop() ?? "";
    return lines.flatMap((line) => {
      const value = line.trim();
      return value
        ? [parsePublicEvent(value)].filter((event): event is KiroPublicEvent => event !== null)
        : [];
    });
  }

  finish(): KiroPublicEvent[] {
    const value = this.buffer.trim();
    this.buffer = "";
    return value
      ? [parsePublicEvent(value)].filter((event): event is KiroPublicEvent => event !== null)
      : [];
  }
}

export function decodeKiroJsonl(chunks: readonly Uint8Array[]): KiroPublicEvent[] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const events = new KiroJsonlDecoder();
  const result: KiroPublicEvent[] = [];
  for (const chunk of chunks) result.push(...events.feed(decoder.decode(chunk, { stream: true })));
  result.push(...events.feed(decoder.decode()));
  result.push(...events.finish());
  return result;
}
