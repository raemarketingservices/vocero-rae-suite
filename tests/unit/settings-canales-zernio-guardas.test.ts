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
      { source: "zernio", igUserId: "1784", accountRef: ACCOUNT, token: KEY }
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("cuenta_ya_conectada");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveIg).not.toHaveBeenCalled();
  });

  it("deja conectar la cuenta cuando no tiene dueña o cuando es suya", async () => {
    for (const dueñaDe of [null, { organizationId: "org_a" }]) {
      saveIg.mockClear();
      dueña.current = dueñaDe;
      const res = await put(
        putInstagram,
        "/api/settings/instagram",
        { source: "zernio", igUserId: "1784", accountRef: ACCOUNT, token: KEY }
      );
      expect(res.status).toBe(200);
      expect(saveIg.mock.calls[0]![0]).toMatchObject({
        organizationId: "org_a",
        accountRef: ACCOUNT,
      });
    }
  });

  it("en modo Zernio sin accountId no hay nada que guardar", async () => {
    const res = await put(putInstagram, "/api/settings/instagram", {
      source: "zernio",
      igUserId: "1784",
      token: KEY,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_body");
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
