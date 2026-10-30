import { describe, expect, it } from "vitest";
import { apiError } from "@/lib/api";
import { MetaApiError } from "@/lib/meta/client";
import { codigoDeEnvioMeta, describeSendError } from "@/lib/meta/send-errors";
import { hintParaFalloDeEnvio } from "@/server/channels/hints";
import { SendError } from "@/server/inbox/send";

/**
 * La pista en español de un fallo de envío.
 *
 * Lo que importa no es el texto exacto sino dos cosas: que el operador salga con
 * una acción, y que un fallo que no sabemos interpretar NO se invente una.
 */
describe("hintParaFalloDeEnvio", () => {
  it("traduce la ventana cerrada que Zernio nombra con un texto suyo", () => {
    const hint = hintParaFalloDeEnvio({
      channel: "whatsapp",
      status: 400,
      code: "TEMPLATE_REQUIRED",
    });
    expect(hint).toContain("plantilla aprobada");
  });

  it("acepta ese código en cualquier caja", () => {
    expect(
      hintParaFalloDeEnvio({ channel: "whatsapp", status: 400, code: "template_required" })
    ).toContain("plantilla aprobada");
  });

  it("en Instagram dice que no hay plantillas en vez de pedir una", () => {
    const hint = hintParaFalloDeEnvio({
      channel: "instagram",
      status: 400,
      code: "REENGAGEMENT_MESSAGE",
    });
    expect(hint).toContain("ventana de 24 horas");
    expect(hint).not.toContain("plantilla aprobada");
  });

  it("manda a revisar las credenciales en 401 y 403", () => {
    for (const status of [401, 403]) {
      expect(hintParaFalloDeEnvio({ channel: "whatsapp", status })).toContain("credenciales");
    }
  });

  it("separa la cuenta sin plan (402) de la llave muerta", () => {
    expect(hintParaFalloDeEnvio({ channel: "whatsapp", status: 402 })).toContain("plan o saldo");
  });

  it("pide esperar cuando el proveedor limita (429)", () => {
    expect(hintParaFalloDeEnvio({ channel: "messenger", status: 429 })).toContain("limitando");
  });

  it("sospecha de la ventana en un 400 de IG/Messenger, que no traen código", () => {
    expect(hintParaFalloDeEnvio({ channel: "messenger", status: 400 })).toContain("ventana");
  });

  it("no inventa pista para lo que no sabe leer", () => {
    expect(hintParaFalloDeEnvio({ channel: "whatsapp", status: 400 })).toBeUndefined();
    expect(
      hintParaFalloDeEnvio({ channel: "whatsapp", status: 400, code: 999999 })
    ).toBeUndefined();
    expect(hintParaFalloDeEnvio({ channel: "whatsapp", status: 500 })).toBeUndefined();
    expect(hintParaFalloDeEnvio({ channel: "whatsapp", status: 0 })).toBeUndefined();
  });
});

/**
 * El código de la ventana cerrada no siempre viene donde uno lo busca: sin esta
 * extracción el 131047 más común se queda en inglés crudo en la bandeja.
 */
describe("codigoDeEnvioMeta", () => {
  const err = (code: number | null, details: unknown) =>
    new MetaApiError("(#131047) Re-engagement message", { status: 400, code, details });

  it("lo toma del error.code cuando es conocido", () => {
    expect(codigoDeEnvioMeta(err(131047, null))).toBe(131047);
  });

  it("lo saca de error_data.code cuando arriba solo hay un 400 genérico", () => {
    const details = { error: { code: 100, error_data: { code: 131047 } } };
    expect(codigoDeEnvioMeta(err(null, details))).toBe(131047);
  });

  it("prefiere un código conocido a otro que no lo está", () => {
    const details = { error: { code: 100, error_data: { code: 131026 } } };
    expect(codigoDeEnvioMeta(err(100, details))).toBe(131026);
  });

  it("devuelve el código aunque no esté en la tabla, y null si no hay nada", () => {
    expect(codigoDeEnvioMeta(err(999999, null))).toBe(999999);
    expect(codigoDeEnvioMeta(err(null, "respuesta no-JSON"))).toBeNull();
  });

  it("con el código conocido el texto sale en español y conserva la referencia", () => {
    const texto = describeSendError(codigoDeEnvioMeta(err(null, { error: { error_data: { code: 131047 } } })), "boom");
    expect(texto).toContain("plantilla aprobada");
    expect(texto).toContain("(Meta 131047)");
  });

  it("sin código deja el texto del proveedor intacto", () => {
    expect(describeSendError(codigoDeEnvioMeta(err(null, null)), "boom")).toBe("boom");
  });
});

describe("SendError con pista", () => {
  it("la guarda cuando viene y queda vacía cuando no", () => {
    expect(new SendError("meta_error", "boom").hint).toBeUndefined();
    expect(new SendError("meta_error", "boom", "haz esto").hint).toBe("haz esto");
  });
});

describe("apiError con pista", () => {
  it("la incluye en el cuerpo solo si existe", async () => {
    const conPista = (await apiError(422, "meta_error", "boom", "haz esto").json()) as {
      error: Record<string, unknown>;
    };
    expect(conPista.error).toEqual({ code: "meta_error", message: "boom", hint: "haz esto" });

    const sinPista = (await apiError(422, "meta_error", "boom").json()) as {
      error: Record<string, unknown>;
    };
    expect(sinPista.error).toEqual({ code: "meta_error", message: "boom" });
    expect("hint" in sinPista.error).toBe(false);
  });
});
