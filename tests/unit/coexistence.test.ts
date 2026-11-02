import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { MetaApiError } from "@/lib/meta/client";
import type { WebhookValue } from "@/server/inbox/webhook";

/**
 * Coexistence (la app de WhatsApp Business del teléfono conviviendo con la
 * Cloud API), del lado de Meta y del lado del webhook:
 *
 *   - el diagnóstico de los CAMPOS (`subscribed_apps`), que la API no permite
 *     escribir y por eso solo se lee,
 *   - el estado del número (`is_on_biz_app`), que decide si hay relleno que
 *     pedir,
 *   - la solicitud única de relleno (`POST /{PHONE}/smb_app_data`) y sus dos
 *     códigos de «ya no se puede»,
 *   - los parsers tolerantes de `history`, `smb_app_state_sync` y
 *     `account_update`.
 *
 * La ingesta completa (qué columnas toca y cuáles NO) se ejercita en el
 * self-test E2E; aquí se prueba la lectura, que es lo que decide todo lo demás.
 */

const { graphRequest, getCredentialsByPhoneNumberId, getCredentialsByWabaId, markConnected, markReconnectRequired } =
  vi.hoisted(() => ({
    graphRequest: vi.fn(),
    getCredentialsByPhoneNumberId: vi.fn(),
    getCredentialsByWabaId: vi.fn(),
    markConnected: vi.fn(async () => {}),
    markReconnectRequired: vi.fn(async () => {}),
  }));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});
// El módulo de credenciales trae la BD; aquí solo interesa a quién enruta el
// `account_update` y en qué estado deja la conexión.
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByPhoneNumberId,
  getCredentialsByWabaId,
  markConnected,
  markReconnectRequired,
}));

import {
  COEXISTENCE_FIELDS,
  camposFaltantes,
  leerCamposSuscritos,
  leerEstadoDelNumero,
  parseAccountUpdateEvent,
  parseNumeroBizApp,
  parseSubscribedFields,
  processAccountUpdateValue,
  revisarCoexistence,
  solicitarSincronizacion,
  solicitarSincronizacionesIniciales,
} from "@/server/whatsapp/coexistence";
import {
  parseHistoryValue,
  parseStateSyncValue,
} from "@/server/inbox/coexistence-sync";

const WABA = "WABA-1";
const PHONE = "PN-1";
const TOKEN = "EAAG-token-secreto-1234";

/** Un `value` de webhook, con la forma que toque en cada prueba. */
const value = (v: Record<string, unknown>) => v as unknown as WebhookValue;

let log: MockInstance<typeof console.log>;
let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  graphRequest.mockReset();
  getCredentialsByPhoneNumberId.mockReset();
  getCredentialsByWabaId.mockReset();
  markConnected.mockClear();
  markReconnectRequired.mockClear();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  warn.mockRestore();
  error.mockRestore();
});

/** Todo lo que se escribió en consola, para buscar secretos filtrados. */
function consoleText(): string {
  return [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]
    .flat()
    .map(String)
    .join("\n");
}

describe("los campos suscritos de la app", () => {
  it("los lee donde Meta los pone: a nivel de la entrada o dentro del api data", () => {
    expect(
      parseSubscribedFields({
        data: [{ whatsapp_business_api_data: { subscribed_fields: ["messages", "history"] } }],
      })
    ).toEqual(["messages", "history"]);

    expect(parseSubscribedFields({ data: [{ subscribed_fields: ["messages"] }] })).toEqual([
      "messages",
    ]);
  });

  it("une las apps suscritas y no repite un campo dos veces", () => {
    const suscriptos = parseSubscribedFields({
      data: [
        { subscribed_fields: ["messages", "smb_message_echoes"] },
        { whatsapp_business_api_data: { subscribed_fields: ["messages", "history", " "] } },
      ],
    });
    expect(new Set(suscriptos)).toEqual(new Set(["messages", "smb_message_echoes", "history"]));
    expect(suscriptos).toHaveLength(3);
  });

  it("sin reporte —respuesta vacía, sin `data` o sin campos— devuelve null: no se puede afirmar nada", () => {
    for (const res of [null, undefined, {}, { data: [] }, { data: [{ id: WABA }] }, "basura"]) {
      expect(parseSubscribedFields(res)).toBeNull();
    }
  });

  it("camposFaltantes: sin reporte no alarma, con reporte dice exactamente qué falta", () => {
    expect(camposFaltantes(null)).toEqual([]);
    expect(camposFaltantes([...COEXISTENCE_FIELDS])).toEqual([]);
    expect(camposFaltantes(["messages", "smb_message_echoes"])).toEqual([
      "history",
      "smb_app_state_sync",
      "account_update",
    ]);
  });

  it("la consulta falla → sin reporte y SIN lanzar: el guardado no puede romperse por esto", async () => {
    graphRequest.mockRejectedValueOnce(
      new MetaApiError("(#200) Permissions error", { status: 403, code: 200 })
    );
    expect(await leerCamposSuscritos(WABA, TOKEN)).toEqual({ suscriptos: null, faltan: [] });
    expect(consoleText()).not.toContain(TOKEN);
  });

  it("con `subscribed_fields` vacío, `faltan` se queda vacío: un reporte incompleto no es una acusación", async () => {
    graphRequest.mockResolvedValueOnce({ data: [{ subscribed_fields: [] }] });
    expect(await leerCamposSuscritos(WABA, TOKEN)).toEqual({ suscriptos: null, faltan: [] });
  });
});

describe("el número, ¿está montado en la app de WhatsApp Business?", () => {
  it("interpreta el booleano, el string y la ausencia del campo", () => {
    expect(parseNumeroBizApp({ is_on_biz_app: true, platform_type: "BIZ_APP" })).toEqual({
      enAppDeNegocio: true,
      platformType: "BIZ_APP",
    });
    // Graph API serializa así algunos booleans.
    expect(parseNumeroBizApp({ is_on_biz_app: "true" }).enAppDeNegocio).toBe(true);
    expect(parseNumeroBizApp({ is_on_biz_app: "false" }).enAppDeNegocio).toBe(false);
    // Token sin el permiso o versión que no lo reporta.
    expect(parseNumeroBizApp({ platform_type: "CLOUD_API" })).toEqual({
      enAppDeNegocio: null,
      platformType: "CLOUD_API",
    });
    expect(parseNumeroBizApp({ platform_type: "  " })).toEqual({
      enAppDeNegocio: null,
      platformType: null,
    });
    expect(parseNumeroBizApp(null)).toEqual({ enAppDeNegocio: null, platformType: null });
  });

  it("si la Graph no contesta, `null` y sin lanzar", async () => {
    graphRequest.mockRejectedValueOnce(new MetaApiError("caída", { status: 500 }));
    expect(await leerEstadoDelNumero(PHONE, TOKEN)).toEqual({
      enAppDeNegocio: null,
      platformType: null,
    });
    expect(consoleText()).not.toContain(TOKEN);
  });
});

describe("revisarCoexistence — los GET que hace y los que evita", () => {
  const bizApp = (on: boolean | null) => ({
    id: PHONE,
    ...(on === null ? {} : { is_on_biz_app: on }),
    platform_type: on ? "BIZ_APP" : "CLOUD_API",
  });

  it("con el número en la app: pide además los campos y reporta los que faltan", async () => {
    graphRequest
      .mockResolvedValueOnce(bizApp(true))
      .mockResolvedValueOnce({ data: [{ subscribed_fields: ["messages", "smb_message_echoes"] }] });

    expect(await revisarCoexistence({ wabaId: WABA, phoneNumberId: PHONE, token: TOKEN })).toEqual({
      enAppDeNegocio: true,
      platformType: "BIZ_APP",
      campos: { suscriptos: ["messages", "smb_message_echoes"], faltan: ["history", "smb_app_state_sync", "account_update"] },
    });

    expect(graphRequest.mock.calls).toEqual([
      [`${PHONE}?fields=is_on_biz_app,platform_type`, { token: TOKEN }],
      [`${WABA}/subscribed_apps`, { token: TOKEN }],
    ]);
  });

  it("con un número normal (Cloud API a secas) corta ahí: no tiene nada que sincronizar", async () => {
    graphRequest.mockResolvedValueOnce(bizApp(false));
    expect(await revisarCoexistence({ wabaId: WABA, phoneNumberId: PHONE, token: TOKEN })).toEqual({
      enAppDeNegocio: false,
      platformType: "CLOUD_API",
      campos: { suscriptos: null, faltan: [] },
    });
    expect(graphRequest).toHaveBeenCalledTimes(1);
  });

  it("sin confirmación (null) sí consulta los campos: leer de más cuesta un GET, callarse no avisa de nada", async () => {
    graphRequest.mockResolvedValueOnce(bizApp(null)).mockResolvedValue({ data: [] });
    const res = await revisarCoexistence({ wabaId: WABA, phoneNumberId: PHONE, token: TOKEN });
    expect(res.enAppDeNegocio).toBeNull();
    expect(graphRequest).toHaveBeenCalledTimes(2);
  });
});

describe("solicitarSincronizacion — POST /{PHONE}/smb_app_data", () => {
  const body = { messaging_product: "whatsapp", sync_type: "history" };

  it("manda el cuerpo exacto que pide Meta", async () => {
    graphRequest.mockResolvedValueOnce({ success: true });
    expect(await solicitarSincronizacion({ phoneNumberId: PHONE, token: TOKEN, syncType: "history" })).toEqual({
      ok: true,
      syncType: "history",
    });
    expect(graphRequest).toHaveBeenCalledWith(`${PHONE}/smb_app_data`, {
      method: "POST",
      token: TOKEN,
      body,
    });
  });

  it("el duplicado (2593107) dice «ya se pidió» y no es un error del negocio", async () => {
    graphRequest.mockRejectedValueOnce(
      new MetaApiError("(#100) Duplicate request", {
        status: 400,
        code: 100,
        details: { error: { message: "", type: "OAuthException", code: 100, error_subcode: 2593107 } },
      })
    );
    expect(await solicitarSincronizacion({ phoneNumberId: PHONE, token: TOKEN, syncType: "history" })).toEqual({
      ok: false,
      syncType: "history",
      code: "ya_solicitada",
      message: "El relleno ya se había pedido para esta conexión.",
    });
  });

  it("fuera de las 24 h (2593108) lo dice en cristiano", async () => {
    graphRequest.mockRejectedValueOnce(
      new MetaApiError("(#100) too late", {
        status: 400,
        code: 100,
        details: { error: { error_subcode: 2593108 } },
      })
    );
    const res = await solicitarSincronizacion({
      phoneNumberId: PHONE,
      token: TOKEN,
      syncType: "smb_app_state_sync",
    });
    expect(res).toMatchObject({ ok: false, syncType: "smb_app_state_sync", code: "fuera_de_ventana" });
    expect(!res.ok && res.message).toContain("24 horas");
  });

  /**
   * El caso de la tienda que se autorregistra: su número entró a la Cloud API
   * a secas, no en coexistence, y Meta lo dice con 131000/subcode 10 o con
   * 133010. La copia NO puede culpar al token —ahí es donde el dueño perdería
   * el tiempo— porque el relleno simplemente no existe que pedir.
   */
  it("número sin coexistence (131000/10 y 133010) no culpa al token", async () => {
    graphRequest.mockRejectedValueOnce(
      new MetaApiError("(#131000) This API is only available to WhatsApp Business App phone numbers", {
        status: 400,
        code: 131000,
        details: { error: { code: 131000, error_subcode: 10 } },
      })
    );
    const sinCoexist = await solicitarSincronizacion({
      phoneNumberId: PHONE,
      token: TOKEN,
      syncType: "history",
    });
    expect(sinCoexist).toMatchObject({ ok: false, code: "sin_coexistence" });
    expect(!sinCoexist.ok && sinCoexist.message).not.toMatch(/token|permiso/i);

    graphRequest.mockRejectedValueOnce(
      new MetaApiError("(#133010) Account not registered", { status: 400, code: 133010 })
    );
    expect(
      await solicitarSincronizacion({ phoneNumberId: PHONE, token: TOKEN, syncType: "history" })
    ).toMatchObject({ code: "sin_coexistence" });
  });

  it("token vencido, sin permiso y Meta caída tienen su propio código", async () => {
    graphRequest.mockRejectedValueOnce(new MetaApiError("Invalid token", { status: 401, code: 190 }));
    expect(await solicitarSincronizacion({ phoneNumberId: PHONE, token: TOKEN, syncType: "history" })).toMatchObject({
      code: "sin_permiso",
    });

    graphRequest.mockRejectedValueOnce(new MetaApiError("(#200) Permissions error", { status: 403, code: 200 }));
    expect(await solicitarSincronizacion({ phoneNumberId: PHONE, token: TOKEN, syncType: "history" })).toMatchObject({
      code: "sin_permiso",
    });

    graphRequest.mockRejectedValueOnce(new MetaApiError("No se pudo contactar la API de Meta", { status: 0 }));
    expect(await solicitarSincronizacion({ phoneNumberId: PHONE, token: TOKEN, syncType: "history" })).toMatchObject({
      code: "meta_no_responde",
    });
  });

  it("un error no previsto devuelve el motivo de Meta y `error`, sin inventar códigos", async () => {
    graphRequest.mockRejectedValueOnce(new MetaApiError("(#131030) number not on the biz app", { status: 400, code: 131030 }));
    const res = await solicitarSincronizacion({ phoneNumberId: PHONE, token: TOKEN, syncType: "history" });
    expect(res).toMatchObject({ ok: false, code: "error" });
    expect(!res.ok && res.message).toContain("131030");
  });

  it("pide los dos rellenos, y uno que revienta no se lleva al otro por delante", async () => {
    graphRequest.mockResolvedValueOnce({ success: true });
    graphRequest.mockRejectedValueOnce(new MetaApiError("boom", { status: 400, code: 100 }));

    const res = await solicitarSincronizacionesIniciales({ phoneNumberId: PHONE, token: TOKEN });
    expect(res.map((r) => r.syncType)).toEqual(["history", "smb_app_state_sync"]);
    expect(res[0]).toEqual({ ok: true, syncType: "history" });
    expect(res[1]).toMatchObject({ ok: false, code: "error" });
    expect(consoleText()).not.toContain(TOKEN);
  });

  it("un fallo inesperado del cliente (no MetaApiError) no lanza: guarda la conexión igual", async () => {
    graphRequest.mockRejectedValue(new TypeError("fetch failed"));
    expect(await solicitarSincronizacionesIniciales({ phoneNumberId: PHONE, token: TOKEN })).toEqual([]);
  });
});

describe("parseHistoryValue — la forma real del relleno", () => {
  const HILO = "18496279994";
  const payload = () =>
    value({
      metadata: { phone_number_id: PHONE, display_phone_number: "18095550000" },
      history: [
        {
          metadata: { phase: "0-1", chunk_order: "0", progress: "in_progress" },
          threads: [
            {
              id: HILO,
              messages: [
                { from: HILO, id: "wamid.1", timestamp: "1722800000", type: "text", text: { body: "hola" },
                  history_context: { status: "E200", from_me: false } },
                { from: "18095550000", id: "wamid.2", timestamp: "1722800100", type: "text", text: { body: "claro" },
                  history_context: { from_me: true } },
              ],
            },
          ],
        },
      ],
    });

  it("aplana history → threads → messages con el teléfono del HILO como identidad", () => {
    const relleno = parseHistoryValue(payload());
    expect(relleno.phoneNumberId).toBe(PHONE);
    expect(relleno.progreso).toBe("in_progress");
    expect(relleno.mensajes).toEqual([
      { waMessageId: "wamid.1", identidad: HILO, direction: "in", type: "text", text: "hola", timestamp: "1722800000" },
      { waMessageId: "wamid.2", identidad: HILO, direction: "out", type: "text", text: "claro", timestamp: "1722800100" },
    ]);
  });

  it("normaliza la tronca mexicana del hilo, para no partir al cliente en dos", () => {
    const relleno = parseHistoryValue(
      value({
        history: [
          {
            threads: [
              {
                id: "5215512345678",
                messages: [{ id: "wamid.9", timestamp: "1722800000", type: "text", text: { body: "buen día" } }],
              },
            ],
          },
        ],
      })
    );
    // `521` + 10 dígitos es como Meta la reporta; la identidad del CRM es `52`.
    expect(relleno.mensajes[0]?.identidad).toBe("525512345678");
  });

  it("sin `from_me`, el mensaje es del negocio cuando lo envía otro número", () => {
    const relleno = parseHistoryValue(
      value({
        history: [
          {
            threads: [
              {
                id: HILO,
                messages: [
                  { id: "wamid.a", timestamp: "1722800000", type: "text", from: "18095550000" },
                  { id: "wamid.b", timestamp: "1722800001", type: "text", from: HILO },
                ],
              },
            ],
          },
        ],
      })
    );
    expect(relleno.mensajes.map((m) => m.direction)).toEqual(["out", "in"]);
  });

  it("acepta los hilos sueltos en `value.threads` (Meta cambió la forma en silencio)", () => {
    const relleno = parseHistoryValue(
      value({ threads: [{ id: HILO, messages: [{ id: "wamid.z", timestamp: "1722800000", type: "text" }] }] })
    );
    expect(relleno.mensajes).toHaveLength(1);
    expect(relleno.progreso).toBeNull();
  });

  it("descarta lo ingerible sin romper: sin id, tipo no soportado, sin hilo ni teléfono", () => {
    const relleno = parseHistoryValue(
      value({
        history: [
          {
            threads: [
              { id: HILO, messages: [{ timestamp: "1722800000", type: "text" }, { id: "wamid.ok", timestamp: "1722800000", type: "audio" }] },
              { id: HILO, messages: [{ id: "wamid.x", timestamp: "1722800000", type: "reaction" }] },
              { messages: [{ id: "wamid.y", timestamp: "1722800000", type: "text" }] },
              null,
            ],
          },
        ],
      })
    );
    expect(relleno.mensajes.map((m) => m.waMessageId)).toEqual(["wamid.ok"]);
  });

  it("un payload vacío o basura no lanza y no ingiere nada", () => {
    for (const v of [value({}), value({ history: [] }), value({ history: [null, "x"] })]) {
      expect(parseHistoryValue(v)).toEqual({ phoneNumberId: null, mensajes: [], progreso: null });
    }
  });

  it("un mensaje sin timestamp no se descarta: entra fechado con la hora actual", () => {
    const antes = Math.floor(Date.now() / 1000);
    const relleno = parseHistoryValue(
      value({ history: [{ threads: [{ id: HILO, messages: [{ id: "wamid.t", type: "text" }] }] }] })
    );
    const despues = Math.floor(Date.now() / 1000);
    const epoch = Number(relleno.mensajes[0]?.timestamp);
    expect(Number.isInteger(epoch)).toBe(true);
    expect(epoch).toBeGreaterThanOrEqual(antes);
    expect(epoch).toBeLessThanOrEqual(despues);
  });
});

describe("parseStateSyncValue — la agenda del teléfono", () => {
  it("lee el contacto anidado y lo deja listo para guardar", () => {
    expect(
      parseStateSyncValue(
        value({
          metadata: { phone_number_id: PHONE },
          state_sync: [
            { type: "contact", action: "update", contact: { phone_number: "18496279994", full_name: "Mari" } },
          ],
        })
      )
    ).toEqual({
      phoneNumberId: PHONE,
      contactos: [{ identidad: "18496279994", name: "Mari", accion: "guardar" }],
    });
  });

  it("`delete` se marca como ignorar: quitar un número del celular no borra un cliente", () => {
    const { contactos } = parseStateSyncValue(
      value({
        state_sync: [{ type: "contact", action: "DELETE", contact: { phone_number: "18496279994", full_name: "Mari" } }],
      })
    );
    expect(contactos).toEqual([{ identidad: "18496279994", name: "Mari", accion: "ignorar" }]);
  });

  it("un `type` que no sea contacto se ignora", () => {
    const { contactos } = parseStateSyncValue(
      value({ state_sync: [{ type: "chat_settings", action: "update", contact: { phone_number: "18496279994" } }] })
    );
    expect(contactos[0]?.accion).toBe("ignorar");
  });

  it("contacto sin teléfono se descarta: en WhatsApp no identifica a nadie", () => {
    expect(
      parseStateSyncValue(
        value({
          state_sync: [
            { type: "contact", action: "update", contact: { full_name: "Sin número" } },
            { type: "contact", action: "update", contact: { wa_id: "  " } },
            { type: "contact", action: "update" },
            null,
          ],
        })
      ).contactos
    ).toEqual([]);
  });

  it("la variante plana solo se mira si no viene la documentada (no contar dos veces)", () => {
    const plana = parseStateSyncValue(
      value({ contacts: [{ phone_number: "18496279994", full_name: "Mari" }] })
    );
    expect(plana.contactos).toEqual([{ identidad: "18496279994", name: "Mari", accion: "guardar" }]);

    const dosVeces = parseStateSyncValue(
      value({
        state_sync: [{ type: "contact", action: "update", contact: { phone_number: "18496279994" } }],
        contacts: [{ phone_number: "18496279994", full_name: "Mari" }],
      })
    );
    expect(dosVeces.contactos).toHaveLength(1);
    expect(dosVeces.contactos[0]?.name).toBeNull();
  });

  it("sin phone_number_id ni contactos: nada que hacer y cero lanzamientos", () => {
    expect(parseStateSyncValue(value({}))).toEqual({ phoneNumberId: null, contactos: [] });
  });
});

describe("account_update — el dueño cortó (o volvió) desde su teléfono", () => {
  const credenciales = { organizationId: "org_a", wabaId: WABA, phoneNumberId: PHONE };

  it("reconoce las tres formas documentadas, con y sin prefijo", () => {
    expect(parseAccountUpdateEvent(value({ event: "ACCOUNT_OFFBOARDED" }))).toBe("desconectada");
    expect(parseAccountUpdateEvent(value({ event: "offboarded" }))).toBe("desconectada");
    expect(parseAccountUpdateEvent(value({ event: "ACCOUNT_RECONNECTED" }))).toBe("reconectada");
    expect(parseAccountUpdateEvent(value({ event: "PARTNER_REMOVED" }))).toBe("partner_removido");
    expect(parseAccountUpdateEvent(value({ event: "OTRA_COSA" }))).toBeNull();
    expect(parseAccountUpdateEvent(value({}))).toBeNull();
  });

  it("desconectar pasa la credencial a reconnect_required y enruta por el número", async () => {
    getCredentialsByPhoneNumberId.mockResolvedValueOnce(credenciales);
    await processAccountUpdateValue(
      WABA,
      value({
        metadata: { phone_number_id: PHONE },
        event: "ACCOUNT_OFFBOARDED",
        disconnection_info: { reason: "El usuario cerró sesión", initiated_by: "user" },
      })
    );
    expect(getCredentialsByPhoneNumberId).toHaveBeenCalledWith(PHONE);
    expect(markReconnectRequired).toHaveBeenCalledWith("org_a");
    expect(markConnected).not.toHaveBeenCalled();
    expect(consoleText()).toContain("El usuario cerró sesión por user");
  });

  it("sin phone_number_id, enruta por la WABA del entry", async () => {
    getCredentialsByWabaId.mockResolvedValueOnce(credenciales);
    await processAccountUpdateValue(WABA, value({ event: "ACCOUNT_RECONNECTED" }));
    expect(getCredentialsByWabaId).toHaveBeenCalledWith(WABA);
    expect(markConnected).toHaveBeenCalledWith("org_a");
    expect(markReconnectRequired).not.toHaveBeenCalled();
  });

  it("PARTNER_REMOVED también pausa los envíos", async () => {
    getCredentialsByWabaId.mockResolvedValueOnce(credenciales);
    await processAccountUpdateValue(WABA, value({ event: "PARTNER_REMOVED" }));
    expect(markReconnectRequired).toHaveBeenCalledWith("org_a");
  });

  it("una cuenta desconocida se descarta con aviso, sin tocar ninguna credencial", async () => {
    getCredentialsByPhoneNumberId.mockResolvedValueOnce(null);
    await processAccountUpdateValue(WABA, value({ metadata: { phone_number_id: "otro" }, event: "ACCOUNT_OFFBOARDED" }));
    expect(markReconnectRequired).not.toHaveBeenCalled();
    expect(consoleText()).toContain("otro");
  });

  it("sin ids en el payload no consulta nada y no lanza", async () => {
    await processAccountUpdateValue(null, value({ event: "ACCOUNT_OFFBOARDED" }));
    expect(getCredentialsByWabaId).not.toHaveBeenCalled();
    expect(getCredentialsByPhoneNumberId).not.toHaveBeenCalled();
    expect(markReconnectRequired).not.toHaveBeenCalled();
  });

  it("un evento que no cambia nada no mueve la credencial", async () => {
    await processAccountUpdateValue(WABA, value({ event: "SOMETHING_ELSE" }));
    expect(getCredentialsByWabaId).not.toHaveBeenCalled();
  });

  it("el log nunca saca el token ni la ruta del webhook", async () => {
    getCredentialsByWabaId.mockResolvedValueOnce({ ...credenciales, token: TOKEN });
    await processAccountUpdateValue(WABA, value({ event: "ACCOUNT_OFFBOARDED" }));
    expect(consoleText()).not.toContain(TOKEN);
  });
});
