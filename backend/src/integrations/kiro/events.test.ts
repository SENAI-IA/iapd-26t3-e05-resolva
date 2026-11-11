import { describe, expect, it } from "vitest";
import { decodeKiroJsonl, KiroEventError, KiroJsonlDecoder } from "./events.js";

describe("eventos públicos do Kiro", () => {
  it("decodifica JSONL fragmentado com Unicode", () => {
    const decoder = new KiroJsonlDecoder();
    expect(decoder.feed('{"type":"message","message":"Olá ')).toEqual([]);
    expect(decoder.feed('mundo"}\n{"type":"tool","name":"read_file","status":"sta')).toEqual([
      { kind: "message", message: "Olá mundo" },
    ]);
    expect(decoder.feed('rted"}\n')).toEqual([
      { kind: "tool", name: "read_file", status: "started" },
    ]);
    expect(decoder.finish()).toEqual([]);
  });

  it("ignora eventos desconhecidos sem transformá-los em evidência", () => {
    expect(
      decodeKiroJsonl([
        new TextEncoder().encode('{"type":"internal_reasoning","content":"privado"}\n'),
        new TextEncoder().encode('{"type":"warning","message":"Atenção"}\n'),
      ]),
    ).toEqual([{ kind: "warning", message: "Atenção" }]);
  });

  it("recusa JSON inválido e evento público malformado", () => {
    const decoder = new KiroJsonlDecoder();
    expect(() => decoder.feed("não é JSON\n")).toThrow(KiroEventError);
    expect(() => decoder.feed('{"type":"message","message":""}\n')).toThrow(KiroEventError);
  });
});
