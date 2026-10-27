import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El intercambio del código del registro insertado (Embedded Signup) de Meta.
 *
 * Es la pieza delicada: va contra la Graph con el SECRETO de la app en la
 * query. Se comprueba la URL exacta, que la llamada sale sin header de
 * credencial (aquí autentica el secreto, no un Bearer), que las dos formas que
 * Meta devuelve (token suelto u objeto) se aceptan, y que ningún error reenvía
 * el secreto ni la respuesta cruda.
 */

const env = vi.hoisted(() => ({
  APP_BASE_URL: "https://crm.ejemplo.test",
  META_WEBHOOK_VERIFY_TOKEN: "verify-token-xyz",
  META_GRAPH_BASE_URL: "https://graph.facebook.com",
  META_GRAPH_API_VERSION: "v25.0",
  META_APP_ID: "1234567890",
  META_APP_SECRET: "secreto-de-la-app",
  META_EMBEDDED_SIGNUP_CONFIG_ID: "9876",
}));
const save = vi.hoisted(() => vi.fn(async () => {}));
const conexiones = vi.hoisted(() => ({
  current: null as null | { source: string },
}));

vi.mock("@/lib/env", () => ({ getEnv: () => env }));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async () => conexiones.current,
  hablaPorZernio: (c: { source?: string } | null) => c?.source === "zernio",
  saveCredentials: save,
}));
vi.mock("@/server/whatsapp/connect", () => ({
  registerWebhookForNumber: async () => ({ ok: true, appWithoutWebhook: true }),
  testConnection: async () => ({
    ok: true,
    displayPhoneNumber: "+52 55 0000 0000",
    verifiedName: "Negocio",
  }),
}));

import {
  completarRegistroInsertado,
  embeddedSignupConfig,
  embeddedSignupEnabled,
  intercambiarCodigo,
} from "@/server/whatsapp/embedded-signup";

const fetchMock = vi.fn();
const SECRET = "secreto-de-la-app";

beforeEach(() => {
  fetchMock.mockReset();
  save.mockClear();
  conexiones.current = null;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(data: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(data), { status }));
}

function metaError(status: number, code: number, message = "error de Meta") {
  respond({ error: { message, code, type: "OAuthException" } }, status);
}

function urlLlamada(i = 0): string {
  const [url] = fetchMock.mock.calls[i]! as [string];
  return url;
}

describe("la bandera del registro insertado", () => {
  it("existe solo con app id, app secret y config id", () => {
    expect(embeddedSignupEnabled()).toBe(true);
    const configId = env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    env.META_EMBEDDED_SIGNUP_CONFIG_ID = "";
    expect(embeddedSignupEnabled()).toBe(false);
    env.META_EMBEDDED_SIGNUP_CONFIG_ID = configId;
  });

  it("entrega al navegador los IDs públicos y jamás el secreto", () => {
    const cfg = embeddedSignupConfig();
    expect(cfg).toEqual({
      enabled: true,
      appId: "1234567890",
      configId: "9876",
      graphVersion: "v25.0",
    });
    expect(JSON.stringify(cfg)).not.toContain(SECRET);
  });
});

describe("intercambiarCodigo", () => {
  it("llama a GET /oauth/access_token con client_id, client_secret y code, sin Bearer", async () => {
    respond({ access_token: "EAAG-token-del-cliente" });
    const r = await intercambiarCodigo("AQDcodigo");
    expect(r).toMatchObject({ ok: true, token: "EAAG-token-del-cliente" });

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect((init.headers ?? {}) as Record<string, string>).not.toHaveProperty("Authorization");
    const q = new URL(urlLlamada()).searchParams;
    expect(urlLlamada()).toContain("/v25.0/oauth/access_token?");
    expect(q.get("client_id")).toBe("1234567890");
    expect(q.get("client_secret")).toBe(SECRET);
    expect(q.get("code")).toBe("AQDcodigo");
  });

  it("acepta el token como cuerpo plano y lee la WABA y el negocio", async () => {
    respond("EAAG-token-plano");
    const r = await intercambiarCodigo("AQDcodigo");
    expect(r).toMatchObject({ ok: true, token: "EAAG-token-plano", wabaId: null });

    respond({
      access_token: "EAAG-otro",
      whatsapp_business_account_id: 102290129340398,
      business_id: "555",
    });
    const conIds = await intercambiarCodigo("AQDotro");
    expect(conIds).toMatchObject({
      ok: true,
      token: "EAAG-otro",
      wabaId: "102290129340398",
      businessId: "555",
    });
  });

  it("traduce el código vencido sin filtrar la respuesta cruda", async () => {
    metaError(401, 190, "Error validating verification code");
    const r = await intercambiarCodigo("AQDvencido");
    expect(r).toMatchObject({ ok: false, code: "code_invalido" });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("distingue Meta caída (503) de un rechazo de permisos", async () => {
    metaError(500, 1, "temporarily unavailable");
    expect(await intercambiarCodigo("x")).toMatchObject({ ok: false, code: "meta_indisponible" });

    metaError(400, 100, "Invalid app secret");
    const r = await intercambiarCodigo("x");
    expect(r).toMatchObject({ ok: false, code: "meta_error" });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("avisa si el servidor no tiene las credenciales de la app", async () => {
    const appId = env.META_APP_ID;
    env.META_APP_ID = "";
    const r = await intercambiarCodigo("x");
    expect(r).toMatchObject({ ok: false, code: "sin_configuracion" });
    expect(fetchMock).not.toHaveBeenCalled();
    env.META_APP_ID = appId;
  });

  it("no revienta con una respuesta que no es un token", async () => {
    respond({ unexpected: true });
    expect(await intercambiarCodigo("x")).toMatchObject({
      ok: false,
      code: "respuesta_inesperada",
    });
  });
});

describe("el registro insertado no pisa una conexión de Zernio", () => {
  it("responde 409 antes de gastar el código y no guarda nada", async () => {
    conexiones.current = { source: "zernio" };
    const r = await completarRegistroInsertado({
      organizationId: "org_a",
      code: "AQDcodigo",
      wabaId: "111",
      phoneNumberId: "222",
    });
    expect(r).toMatchObject({ ok: false, code: "canal_zernio" });
    // Ni siquiera se llama a Meta: el código no se consume y el token no se pide.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("con una conexión de Meta (o sin ninguna) el flujo sigue su curso", async () => {
    conexiones.current = { source: "meta" };
    respond("EAAG-token");
    const r = await completarRegistroInsertado({
      organizationId: "org_a",
      code: "AQDcodigo",
    });
    // Sin WABA en la respuesta se detiene ahí, pero la guarda de canal no lo
    // cortó: la llamada a Meta sí ocurrió.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, code: "sin_waba" });
    expect(save).not.toHaveBeenCalled();
  });
});
