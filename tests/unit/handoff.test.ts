import { describe, expect, it } from "vitest";
import { matchesHandoffIntent, respuestaAOferta } from "@/server/ai/handoff";
import { normalizeZernioWhatsappEvent } from "@/server/whatsapp/ingest-zernio";

describe("patrón de respaldo de handoff (FR-022 / SC-006)", () => {
  it.each([
    "quiero hablar con un humano",
    "¿puedo hablar con un asesor?",
    "necesito comunicarme con alguien",
    "quiero contactar a una persona real",
    "quiero hablar con alguien por favor",
    "me pasas a un asesor",
    "prefiero atención humana",
    "atencion humana por favor",
  ])("dispara: %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(true);
  });

  it.each([
    "somos 4 personas", // el caso canónico que NO debe disparar
    "somos cuatro personas y queremos reservar",
    "¿tienen taladros?",
    "la persona que me atendió ayer fue amable",
    "mi humano favorito es mi hijo",
    "el asesor fiscal ya me cobró", // sin verbo de contacto ni "un asesor"
  ])("NO dispara: %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(false);
  });
});

describe("oferta de hablar con una persona", () => {
  it.each([
    ["Sí", "si"],
    ["si", "si"],
    ["SÍ, por favor", "si"],
    ["claro", "si"],
    ["No", "no"],
    ["no gracias", "no"],
    ["¿cuánto cuesta?", null],
    ["no sé todavía", null],
    [null, null],
  ])("%s → %s", (texto, esperado) => {
    expect(respuestaAOferta(texto)).toBe(esperado);
  });

  it.each(["quiero un humano", "pásame con alguien", "pasame con ventas"])(
    "«%s» traspasa",
    (texto) => expect(matchesHandoffIntent(texto)).toBe(true)
  );
});

describe("toque de botón por Zernio", () => {
  it("sin texto entra con el rótulo del botón", () => {
    const evt = normalizeZernioWhatsappEvent({
      event: "message.received",
      account: { id: "a1", platform: "whatsapp" },
      message: {
        id: "m1",
        direction: "incoming",
        text: "",
        metadata: { interactiveId: "Sí" },
        sender: { phoneNumber: "+18091234567" },
      },
    });
    expect(evt?.text).toBe("Sí");
  });
});
