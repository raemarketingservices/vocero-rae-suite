import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 023 — La ruta de alta de WhatsApp por Zernio.
 *
 * Lo que se prueba es lo que no debe pasar nunca: que una llave inválida llegue
 * a la base, que un número conectado por Meta se reescriba con credenciales de
 * Zernio (o al revés), que alguien que no es el propietario conecte el canal, y
 * que la llave completa salga hacia el navegador.
 */

const session = vi.hoisted(() => ({
  current: { userId: "usr_1", organizationId: "org_a", role: "owner" },
}));
const save = vi.hoisted(() => vi.fn(async () => {}));
const disconnect = vi.hoisted(() => vi.fn(async () => {}));
const list = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const creds = vi.hoisted(() => ({
  current: null as null | {
    source: string;
    accountRef: string | null;
    token: string;
    status: string;
    displayPhoneNumber: string | null;
  },
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => session.current,
  getSessionOrNull: async () => session.current,
}));
vi.mock("@/server/whatsapp/credentials", () => ({
  desconectarCanal: disconnect,
  getCredentialsByOrg: async () => creds.current,
  hablaPorZernio: (c: { source?: string } | null) => c?.source === "zernio",
  saveCredentials: save,
  tokenLast4: (t: string) => t.slice(-4),
}));
vi.mock("@/server/zernio", () => ({ listZernioAccounts: list }));

import { MetaApiError } from "@/lib/meta/client";
import { DELETE, GET, PUT } from "@/app/api/settings/whatsapp/zernio/route";

const ACCOUNT = "665f1c2e8b3a4d0012345678";
const KEY = "zrk_abcdef123456";

function put(body: unknown) {
  return PUT(
    new Request("https://crm.ejemplo.test/api/settings/whatsapp/zernio", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function del() {
  // withAuth infiere los argumentos del handler: DELETE no recibe request.
  return DELETE();
}

beforeEach(() => {
  save.mockClear();
  disconnect.mockClear();
  list.mockReset();
  list.mockResolvedValue([]);
  creds.current = null;
  session.current = { userId: "usr_1", organizationId: "org_a", role: "owner" };
});

describe("el alta", () => {
  it("con una sola cuenta la conecta sin pedir el accountId", async () => {
    list.mockResolvedValueOnce([
      { id: ACCOUNT, name: "Uniko RD", isActive: true, needsReconnection: false },
    ]);
    const res = await put({ token: KEY, webhookSecret: "secreto-hmac" });
    expect(res.status).toBe(200);
    expect(save).toHaveBeenCalledWith({
      organizationId: "org_a",
      source: "zernio",
      wabaId: null,
      phoneNumberId: null,
      accountRef: ACCOUNT,
      webhookSecret: "secreto-hmac",
      token: KEY,
      displayPhoneNumber: "Uniko RD",
      verifiedName: null,
    });
  });

  it("con varios números responde 409 con la lista, en lugar de elegir uno al azar", async () => {
    list.mockResolvedValueOnce([
      { id: ACCOUNT, name: "Uniko RD", isActive: true, needsReconnection: false },
      { id: "otra", name: "Impulsa", isActive: true, needsReconnection: false },
    ]);
    const res = await put({ token: KEY });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error.code).toBe("varias_cuentas");
    expect(data.cuentas).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
  });

  it("un accountId que no está en la llave se rechaza con 422", async () => {
    list.mockResolvedValueOnce([
      { id: ACCOUNT, name: "Uniko RD", isActive: true, needsReconnection: false },
    ]);
    const res = await put({ token: KEY, accountRef: "665f00000000000000000000" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("cuenta_no_encontrada");
    expect(save).not.toHaveBeenCalled();
  });

  it("una llave sin números conectados lo dice en español y no deja una conexión vacía", async () => {
    list.mockResolvedValueOnce([]);
    const res = await put({ token: KEY });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("sin_cuentas");
    expect(save).not.toHaveBeenCalled();
  });

  it("la llave no sirve: 422 y nada se guarda", async () => {
    list.mockRejectedValueOnce(new MetaApiError("invalid api key", { status: 401 }));
    const res = await put({ token: "zrk_rota" });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_token");
    expect(save).not.toHaveBeenCalled();
  });

  it("una cuenta de Zernio pausada se distingue de una llave mala", async () => {
    list.mockRejectedValueOnce(new MetaApiError("payment required", { status: 402 }));
    const res = await put({ token: KEY });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/pausada|pago/);
  });

  it("Zernio caído es 503, no un problema de credenciales", async () => {
    list.mockRejectedValueOnce(new MetaApiError("boom", { status: 503 }));
    const res = await put({ token: KEY });
    expect(res.status).toBe(503);
    expect(save).not.toHaveBeenCalled();
  });

  it("solo el propietario conecta el número", async () => {
    session.current = { userId: "usr_2", organizationId: "org_a", role: "admin" };
    const res = await put({ token: KEY });
    expect(res.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("no reescribe con Zernio un número que hoy habla por Meta", async () => {
    creds.current = {
      source: "meta",
      accountRef: null,
      token: "EAAG",
      status: "connected",
      displayPhoneNumber: "+1 849 627 9994",
    };
    const res = await put({ token: KEY });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("canal_meta");
    expect(list).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("lo que se muestra y lo que se suelta", () => {
  it("GET pinta la conexión sin la llave: solo su cola", async () => {
    creds.current = {
      source: "zernio",
      accountRef: ACCOUNT,
      token: KEY,
      status: "connected",
      displayPhoneNumber: "Uniko RD",
    };
    const data = await (await GET()).json();
    expect(data.connection).toEqual({
      source: "zernio",
      accountRef: ACCOUNT,
      displayPhoneNumber: "Uniko RD",
      status: "connected",
      tokenLast4: KEY.slice(-4),
    });
    expect(JSON.stringify(data)).not.toContain(KEY);
  });

  it("GET de una conexión de Meta responde null: esa tarjeta vive en otra ruta", async () => {
    creds.current = {
      source: "meta",
      accountRef: null,
      token: "EAAG",
      status: "connected",
      displayPhoneNumber: "+1 849 627 9994",
    };
    expect(await (await GET()).json()).toEqual({ connection: null });
  });

  it("DELETE suelta una conexión de Zernio sin tocar Meta", async () => {
    creds.current = {
      source: "zernio",
      accountRef: ACCOUNT,
      token: KEY,
      status: "connected",
      displayPhoneNumber: "Uniko RD",
    };
    expect((await del()).status).toBe(200);
    expect(disconnect).toHaveBeenCalledWith("org_a");
  });

  it("DELETE se niega si el número es de Meta: ahí hay un webhook que quitar primero", async () => {
    creds.current = {
      source: "meta",
      accountRef: null,
      token: "EAAG",
      status: "connected",
      displayPhoneNumber: "+1 849 627 9994",
    };
    const res = await del();
    expect(res.status).toBe(409);
    expect(disconnect).not.toHaveBeenCalled();
  });
});
