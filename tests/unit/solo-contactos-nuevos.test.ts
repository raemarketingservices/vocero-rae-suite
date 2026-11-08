import { describe, expect, it } from "vitest";
import { esContactoConocido } from "@/server/inbox/ingest";

// Hilo de Zernio creado el 2026-11-07 17:05:51 UTC (0x6aef5a6f).
const HILO = "6aef5a6f7a16fc278f546c43";
const ANTES = new Date("2026-11-07T17:00:00Z");
const DESPUES = new Date("2026-11-07T18:00:00Z");

describe("esContactoConocido", () => {
  it("apagado: nunca", () => {
    expect(esContactoConocido({ contactoNuevo: false, threadRef: HILO, desde: null })).toBe(false);
  });
  it("contacto que ya estaba en el CRM", () => {
    expect(esContactoConocido({ contactoNuevo: false, threadRef: null, desde: ANTES })).toBe(true);
  });
  it("hilo de Zernio anterior al corte = ya escribía", () => {
    expect(esContactoConocido({ contactoNuevo: true, threadRef: HILO, desde: DESPUES })).toBe(true);
  });
  it("hilo posterior al corte = nuevo", () => {
    expect(esContactoConocido({ contactoNuevo: true, threadRef: HILO, desde: ANTES })).toBe(false);
  });
  it("hilo con otro formato = nuevo", () => {
    expect(esContactoConocido({ contactoNuevo: true, threadRef: "t_abc", desde: DESPUES })).toBe(false);
  });
});
