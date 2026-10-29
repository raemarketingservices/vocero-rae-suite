import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 024 — Las mismas guardas del alta de WhatsApp en Instagram y Messenger.
 *
 * Las dos rutas aceptaban el `accountRef` que escribe el navegador sin mirar a
 * quién pertenecía ya: con una API key de Zernio compartida entre tiendas, la
 * segunda podía reclamar la cuenta de la primera y el inbound del webhook
 * quedaba repartido al azar. Aquí se prueba que eso devuelve 409 y que ni
 * siquiera se llega a llamar a la plataforma.
 */

const session = vi.hoisted(() => ({
  current: { userId: "usr_1", organizationId: "org_a", role: "owner" },
}));
const saveIg = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => {}));
const saveMsg = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => {}));
/** Dueño del accountId que se está intentando conectar. */
const dueña = vi.hoisted(() => ({ current: null as null | { organizationId: string } }));
/** Cuentas que Zernio lista para la llave que se pegó. */
const cuentas = vi.hoisted(() => ({
  current: [] as {
    id: string;
    name: string | null;
    platformUserId: string | null;
  }[],
}));
const lista = vi.hoisted(() => vi.fn(async (_token: string, _platform: string) => cuentas.current));
const fetchSpy = vi.hoisted(() => vi.fn(async () => ({ ok: true, json: async () => ({}) })));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => session.current,
  getSessionOrNull: async () => session.current,
}));
vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: () => true,
  channelDisabledResponse: () => new Response(null, { status: 404 }),
}));
vi.mock("@/server/instagram/credentials", () => ({
  getInstagramCredentialsByAccountRef: async () => dueña.current,
  getInstagramCredentialsByOrg: async () => null,
  saveInstagramCredentials: saveIg,
  tokenLast4: (t: string) => t.slice(-4),
}));
vi.mock("@/server/messenger/credentials", () => ({
  getMessengerCredentialsByAccountRef: async () => dueña.current,
  getMessengerCredentialsByOrg: async () => null,
  saveMessengerCredentials: saveMsg,
  tokenLast4: (t: string) => t.slice(-4),
}));
vi.mock("@/server/zernio", () => ({
  verifyZernioToken: vi.fn(async () => true),
  listZernioAccounts: lista,
}));

import { PUT as putInstagram } from "@/app/api/settings/instagram/route";
import { PUT as putMessenger } from "@/app/api/settings/messenger/route";

const ACCOUNT = "665f1c2e8b3a4d0012345678";
const KEY = "zrk_abcdef123456";

function put(handler: typeof putInstagram, path: string, body: unknown) {
  return handler(
    new Request(`https://crm.ejemplo.test${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  saveIg.mockClear();
  saveMsg.mockClear();
  dueña.current = null;
  cuentas.current = [
    { id: ACCOUNT, name: "tienda.demo", platformUserId: "17841400000000000" },
  ];
  session.current = { userId: "usr_1", organizationId: "org_a", role: "owner" };
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockClear();
});

describe("Instagram por Zernio", () => {
  it("rechaza un accountId que ya es de otra tienda, sin llamar a Zernio", async () => {
    dueña.current = { organizationId: "org_b" };
    const res = await put(
      putInstagram,
      "/api/settings/instagram",
      { source: "zernio", accountRef: ACCOUNT, token: KEY }
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("cuenta_ya_conectada");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lista).not.toHaveBeenCalled();
    expect(saveIg).not.toHaveBeenCalled();
  });

  it("deja conectar la cuenta cuando no tiene dueña o cuando es suya", async () => {
    for (const dueñaDe of [null, { organizationId: "org_a" }]) {
      saveIg.mockClear();
      dueña.current = dueñaDe;
      const res = await put(putInstagram, "/api/settings/instagram", {
        source: "zernio",
        accountRef: ACCOUNT,
        token: KEY,
      });
      expect(res.status).toBe(200);
      expect(saveIg.mock.calls[0]![0]).toMatchObject({
        organizationId: "org_a",
        accountRef: ACCOUNT,
      });
    }
  });

  /**
   * El IG_ID es el que enruta el webhook de Meta, y aquí es el que Zernio
   * reporta: el tecleado por el navegador se ignora.
   */
  it("el IG_ID guardado es el de la cuenta listada, no el que se escribió", async () => {
    const res = await put(putInstagram, "/api/settings/instagram", {
      source: "zernio",
      igUserId: "9999-escrito-a-mano",
      accountRef: ACCOUNT,
      token: KEY,
    });
    expect(res.status).toBe(200);
    expect(saveIg.mock.calls[0]![0].igUserId).toBe("17841400000000000");
  });

  it("con un solo perfil y sin accountId conecta ese", async () => {
    const res = await put(putInstagram, "/api/settings/instagram", {
      source: "zernio",
      token: KEY,
    });
    expect(res.status).toBe(200);
    expect(saveIg.mock.calls[0]![0]).toMatchObject({ accountRef: ACCOUNT });
  });

  it("con varios perfiles y sin accountId devuelve la lista para elegir", async () => {
    cuentas.current = [
      ...cuentas.current,
      { id: "acc_otra", name: "otra.cuenta", platformUserId: "1784" },
    ];
    const res = await put(putInstagram, "/api/settings/instagram", {
      source: "zernio",
      token: KEY,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("varias_cuentas");
    expect(body.cuentas).toHaveLength(2);
    expect(saveIg).not.toHaveBeenCalled();
  });

  it("una llave sin Instagram no deja guardar nada", async () => {
    cuentas.current = [];
    const res = await put(putInstagram, "/api/settings/instagram", {
      source: "zernio",
      token: KEY,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("sin_cuentas");
    expect(saveIg).not.toHaveBeenCalled();
  });

  it("un accountId que no está en la llave se rechaza", async () => {
    const res = await put(putInstagram, "/api/settings/instagram", {
      source: "zernio",
      accountRef: "acc_que_no_existe",
      token: KEY,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("cuenta_no_encontrada");
    expect(saveIg).not.toHaveBeenCalled();
  });

  it("sin IG_ID reportado por Zernio no se guarda una conexión a ciegas", async () => {
    cuentas.current = [{ id: ACCOUNT, name: null, platformUserId: null }];
    const res = await put(putInstagram, "/api/settings/instagram", {
      source: "zernio",
      accountRef: ACCOUNT,
      token: KEY,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("ig_user_id_falta");
    expect(saveIg).not.toHaveBeenCalled();
  });

  it("el modo Meta no pasa por la guarda: ahí no hay accountRef", async () => {
    dueña.current = { organizationId: "org_b" };
    const res = await put(putInstagram, "/api/settings/instagram", {
      source: "meta",
      igUserId: "1784",
      token: "IGQVJ",
    });
    expect(res.status).toBe(200);
    expect(saveIg).toHaveBeenCalled();
  });

  it("el modo Meta sin IG_ID no tiene de dónde sacar el perfil", async () => {
    const res = await put(putInstagram, "/api/settings/instagram", {
      source: "meta",
      token: "IGQVJ",
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_body");
    expect(saveIg).not.toHaveBeenCalled();
  });
});

describe("Messenger por Zernio", () => {
  it("rechaza un accountId que ya es de otra tienda", async () => {
    dueña.current = { organizationId: "org_b" };
    const res = await put(putMessenger, "/api/settings/messenger", {
      source: "zernio",
      accountRef: ACCOUNT,
      token: KEY,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("cuenta_ya_conectada");
    expect(saveMsg).not.toHaveBeenCalled();
  });

  it("deja a la tienda conectar su propia cuenta", async () => {
    dueña.current = { organizationId: "org_a" };
    const res = await put(putMessenger, "/api/settings/messenger", {
      source: "zernio",
      accountRef: ACCOUNT,
      token: KEY,
    });
    expect(res.status).toBe(200);
    expect(saveMsg.mock.calls[0]![0]).toMatchObject({
      organizationId: "org_a",
      accountRef: ACCOUNT,
    });
  });
});
