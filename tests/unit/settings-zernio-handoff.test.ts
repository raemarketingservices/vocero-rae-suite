import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 025 — El escaneo de QR con la llave maestra de RAE.
 *
 * Lo que se prueba es lo que no puede pasar: que una tienda consuma el escaneo
 * de otra, que la llave maestra baje al navegador, que un número ya conectado a
 * otra tienda se reasigne en silencio, que la superficie exista en una instancia
 * que no ofrece el modo RAE, y que un escaneo fallido se responda en español con
 * lo que la persona puede hacer.
 */

const session = vi.hoisted(() => ({
  current: { userId: "usr_1", organizationId: "org_a", role: "owner" },
}));
const env = vi.hoisted(() => ({ llaveMaestra: "zrk_master_0123456789" }));
const creds = vi.hoisted(() => ({
  /** Credenciales hoy guardadas para esta tienda. */
  actuales: null as null | {
    source: string;
    accountRef: string | null;
    token: string;
    status: string;
    displayPhoneNumber: string | null;
    webhookSecret: string | null;
  },
  /** A quién pertenece ya el número que se quiere conectar. */
  dueñaDelNumero: null as null | { organizationId: string },
}));
const save = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => {}));
const zk = vi.hoisted(() => ({
  llamadas: [] as {
    method: string;
    path: string;
    body: unknown;
    headers: Record<string, string>;
  }[],
  /** Respuestas por `MÉTODO /ruta`; una función recibe consulta y cuerpo. */
  plan: {} as Record<string, unknown | ((o: { query: URLSearchParams; body: unknown }) => unknown)>,
  cuentas: [] as unknown[],
}));
const dbf = vi.hoisted(() => ({
  org: { name: "Uniko RD" } as { name: string } | null,
  handoffs: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  borrados: [] as string[][],
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => session.current,
  getSessionOrNull: async () => session.current,
}));

// La llave maestra se cambia por prueba porque `getEnv` memoiza: sin este
// envoltorio, la prueba de «esta instancia no ofrece el modo RAE» dependería del
// orden en que corren los tests.
vi.mock("@/lib/env", async (importActual) => {
  const real = await importActual<typeof import("@/lib/env")>();
  return {
    ...real,
    getEnv: () => ({ ...real.getEnv(), ZERNIO_MASTER_API_KEY: env.llaveMaestra }),
  };
});

vi.mock("@/lib/db", async () => {
  // Columnas de verdad: con strings sueltos drizzle inliga el valor como texto
  // SQL y el fake se quedaría sin los parámetros del WHERE para filtrar.
  const { pgTable, text } = await import("drizzle-orm/pg-core");
  const organization = pgTable("organization", { id: text("id"), name: text("name") });
  const zernioHandoff = pgTable("zernio_handoff", {
    id: text("id"),
    organizationId: text("organization_id"),
    profileId: text("profile_id"),
    status: text("status"),
    accountRef: text("account_ref"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  });

  /**
   * Los valores ligados de una condición de drizzle. Se necesitan porque el
   * fake tiene que filtrar igual que el WHERE real — y una condición no se
   * puede serializar: las columnas apuntan a la tabla, que apunta a las columnas.
   */
  function paramsDe(node: unknown, out: unknown[] = [], seen = new WeakSet()): unknown[] {
    if (node == null || typeof node === "string" || seen.has(node)) return out;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const x of node) paramsDe(x, out, seen);
      return out;
    }
    const n = node as { constructor?: { name?: string }; value?: unknown; queryChunks?: unknown };
    if (n.constructor?.name === "Param" || n.constructor?.name === "SQLParam") {
      out.push(n.value);
      return out;
    }
    paramsDe(n.queryChunks, out, seen);
    return out;
  }

  return {
    getDb: () => ({
      select: () => ({
        from: (tabla: unknown) => ({
          where: (cond: unknown) => ({
            limit: async () => {
              if (tabla === organization) return dbf.org ? [dbf.org] : [];
              // El filtro real es `id` Y `organizationId`: la fila solo aparece
              // si ambos valores están ligados en el WHERE.
              const ligados = paramsDe(cond).map(String);
              return dbf.handoffs.filter(
                (h) => ligados.includes(String(h.id)) && ligados.includes(String(h.organizationId))
              );
            },
          }),
        }),
      }),
      insert: () => ({
        values: async (v: Record<string, unknown>) => {
          dbf.inserts.push(v);
          dbf.handoffs.push({ ...v });
        },
      }),
      delete: () => ({
        where: async (cond: unknown) => {
          const ligados = paramsDe(cond).map(String);
          dbf.borrados.push(ligados);
          dbf.handoffs = dbf.handoffs.filter(
            (h) =>
              !(
                ligados.includes(String(h.organizationId)) &&
                ligados.includes(String(h.status))
              )
          );
        },
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => ({
          where: async (cond: unknown) => {
            const id = paramsDe(cond).map(String)[0];
            const copia = { ...v };
            delete copia.updatedAt;
            dbf.updates.push(copia);
            for (const h of dbf.handoffs) if (String(h.id) === id) Object.assign(h, v);
          },
        }),
      }),
    }),
    schema: { organization, zernioHandoff },
  };
});

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async () => creds.actuales,
  getCredentialsByAccountRef: async () => creds.dueñaDelNumero,
  hablaPorZernio: (c: { source?: string } | null) => c?.source === "zernio",
  saveCredentials: save,
  tokenLast4: (t: string) => t.slice(-4),
}));

vi.mock("@/server/zernio", () => ({
  zernioFetch: async (
    path: string,
    opts: { method?: string; body?: unknown; headers?: Record<string, string> }
  ) => {
    const method = opts.method ?? "GET";
    zk.llamadas.push({ method, path, body: opts.body, headers: opts.headers ?? {} });
    const [sinQuery, query] = path.split("?");
    const respuesta = zk.plan[`${method} ${sinQuery}`];
    if (respuesta === undefined) {
      throw new Error(`el test no previó la llamada Zernio ${method} ${sinQuery}`);
    }
    const res =
      typeof respuesta === "function"
        ? respuesta({ query: new URLSearchParams(query ?? ""), body: opts.body })
        : respuesta;
    if (res instanceof Error) throw res;
    return res;
  },
  listZernioAccounts: async () => zk.cuentas,
}));

import { MetaApiError } from "@/lib/meta/client";
import { GET, POST } from "@/app/api/settings/whatsapp/zernio/handoff/route";

const HANDOFF = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CUENTA = "665f1c2e8b3a4d0012345678";
const PERFIL = "6a180a034c7f364ffded3c9c";

beforeAll(() => {
  process.env.APP_BASE_URL = "https://crm.ejemplo.test";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test-1234";
});

function post(body?: unknown) {
  return POST(
    new Request("https://crm.ejemplo.test/api/settings/whatsapp/zernio/handoff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

function get(handoffId: string) {
  return GET(
    new Request(
      `https://crm.ejemplo.test/api/settings/whatsapp/zernio/handoff?handoffId=${handoffId}`
    )
  );
}

/** Un escaneo ya guardado, como lo dejaría el POST. */
function fila(over: Record<string, unknown> = {}) {
  dbf.handoffs.push({
    id: HANDOFF,
    organizationId: "org_a",
    profileId: PERFIL,
    status: "waiting",
    accountRef: null,
    errorCode: null,
    errorMessage: null,
    ...over,
  });
}

/** Lo mínimo que Zernio necesita responder para que exista un perfil y un link. */
function flujoBase() {
  zk.plan = {
    "GET /profiles": { profiles: [] },
    "POST /profiles": { profile: { _id: PERFIL } },
    "GET /connect/whatsapp": {
      authUrl: "https://zernio.test/oauth",
      handoff: {
        id: HANDOFF,
        url: "https://zernio.test/h/" + HANDOFF,
        expiresAt: new Date(Date.now() + 1800_000).toISOString(),
      },
    },
  };
}

beforeEach(() => {
  session.current = { userId: "usr_1", organizationId: "org_a", role: "owner" };
  env.llaveMaestra = "zrk_master_0123456789";
  creds.actuales = null;
  creds.dueñaDelNumero = null;
  save.mockReset();
  save.mockResolvedValue(undefined);
  zk.llamadas = [];
  zk.plan = {};
  zk.cuentas = [];
  dbf.org = { name: "Uniko RD" };
  dbf.handoffs = [];
  dbf.inserts = [];
  dbf.updates = [];
  dbf.borrados = [];
});

const rutaDelConnect = () =>
  zk.llamadas.find((l) => l.method === "GET" && l.path.startsWith("/connect/whatsapp"))
    ?.path ?? "";

describe("el POST que pide el enlace", () => {
  it("en una instancia sin llave maestra no existe: 404 y nada se habla con Zernio", async () => {
    env.llaveMaestra = "";
    const res = await post();
    expect(res.status).toBe(404);
    expect(zk.llamadas).toHaveLength(0);
  });

  it("solo el propietario arranca un escaneo", async () => {
    session.current = { userId: "usr_2", organizationId: "org_a", role: "admin" };
    const res = await post();
    expect(res.status).toBe(403);
    expect(zk.llamadas).toHaveLength(0);
  });

  it("devuelve el link de escaneo y deja la fila atada a esta tienda", async () => {
    flujoBase();
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ estado: "qr", handoffId: HANDOFF });
    expect(body.url).toContain("zernio.test");
    // El enlace largo es el que se abre con un clic; sin él la tarjeta no tiene
    // a dónde llevar a nadie.
    expect(body.authUrl).toBe("https://zernio.test/oauth");
    expect(dbf.inserts[0]).toMatchObject({
      id: HANDOFF,
      organizationId: "org_a",
      profileId: PERFIL,
      status: "waiting",
    });
  });

  it("la cuenta atrás sale de su propio reloj, no del navegador", async () => {
    flujoBase();
    const body = await (await post()).json();
    expect(body.quedanSegundos).toBeGreaterThan(1700);
    expect(body.quedanSegundos).toBeLessThanOrEqual(1800);
  });

  it("un enlace ya nacido caducado se responde en cero, no con cuenta negativa", async () => {
    flujoBase();
    zk.plan["GET /connect/whatsapp"] = {
      handoff: {
        id: HANDOFF,
        url: "https://zernio.test/h/" + HANDOFF,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    };
    const body = await (await post()).json();
    expect(body.quedanSegundos).toBe(0);
  });

  it("si Zernio no dice cuándo caduca, no se inventa una cuenta atrás", async () => {
    flujoBase();
    zk.plan["GET /connect/whatsapp"] = {
      handoff: { id: HANDOFF, url: "https://zernio.test/h/" + HANDOFF },
    };
    const body = await (await post()).json();
    expect(body.quedanSegundos).toBeNull();
  });

  it("la llave maestra no baja al navegador", async () => {
    flujoBase();
    const texto = await (await post()).text();
    expect(texto).not.toContain(env.llaveMaestra);
  });

  it("pide el escaneo en coexistencia, que es lo que evita portar el número", async () => {
    flujoBase();
    await post();
    const q = new URLSearchParams(rutaDelConnect().split("?")[1] ?? "");
    expect(q.get("handoff")).toBe("true");
    expect(q.get("onboarding")).toBe("business_app");
    expect(q.get("profileId")).toBe(PERFIL);
    expect(q.get("brandName")).toBe("Uniko RD");
  });

  it("reutiliza el perfil de la tienda en vez de crear un segundo", async () => {
    zk.plan = {
      "GET /profiles": {
        profiles: [{ _id: PERFIL, name: "Uniko RD", externalId: "org_a" }],
      },
      "GET /connect/whatsapp": {
        authUrl: "https://zernio.test/oauth",
        handoff: { id: HANDOFF, url: "https://zernio.test/h/" + HANDOFF },
      },
    };
    await post();
    expect(zk.llamadas.some((l) => l.method === "POST" && l.path === "/profiles")).toBe(false);
  });

  it("el perfil se busca por la organización, no por el nombre", async () => {
    flujoBase();
    await post();
    const q = new URLSearchParams(
      zk.llamadas.find((l) => l.path.startsWith("/profiles?"))?.path.split("?")[1] ?? ""
    );
    expect(q.get("externalId")).toBe("org_a");
  });

  it("no reescribe con Zernio un número que hoy habla por Meta", async () => {
    creds.actuales = {
      source: "meta",
      accountRef: null,
      token: "EAAG",
      status: "connected",
      displayPhoneNumber: "+1 849 627 9994",
      webhookSecret: null,
    };
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("canal_meta");
    expect(zk.llamadas).toHaveLength(0);
  });

  it("cuando Zernio reactiva la cuenta no hay QR: se conecta en el mismo POST", async () => {
    creds.actuales = {
      source: "zernio",
      accountRef: CUENTA,
      token: env.llaveMaestra,
      status: "reconnect_required",
      displayPhoneNumber: "+1 849 627 9994",
      webhookSecret: null,
    };
    zk.plan = {
      "GET /profiles": { profiles: [{ _id: PERFIL, externalId: "org_a" }] },
      "GET /connect/whatsapp": {
        authUrl: "https://zernio.test/oauth",
        account: { _id: CUENTA, username: "Uniko RD", metadata: { displayPhoneNumber: "+1 849 627 9994" } },
      },
      "GET /webhooks/settings": { webhooks: [] },
      "POST /webhooks/settings": { webhook: { secret: "secreto-hmac" } },
    };
    const res = await post({ reconectar: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ estado: "connected", webhookOk: true });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ accountRef: CUENTA, profileRef: PERFIL, source: "zernio" })
    );
    // Reconectar es el mismo escaneo pero anclado a la cuenta que ya era de la
    // tienda: sin el parámetro, Zernio abriría un número nuevo en el perfil.
    expect(new URLSearchParams(rutaDelConnect().split("?")[1] ?? "").get("reconnectAccountId")).toBe(
      CUENTA
    );
  });

  it("sin el aviso de reconectar, el escaneo no ancla ninguna cuenta", async () => {
    creds.actuales = {
      source: "zernio",
      accountRef: CUENTA,
      token: env.llaveMaestra,
      status: "connected",
      displayPhoneNumber: "+1 849 627 9994",
      webhookSecret: null,
    };
    flujoBase();
    await post();
    const q = new URLSearchParams(rutaDelConnect().split("?")[1] ?? "");
    expect(q.get("reconnectAccountId")).toBeNull();
  });

  it("un escaneo nuevo deja sin efecto el que estaba en curso, de esta tienda", async () => {
    flujoBase();
    fila({ id: "escaneo-anterior", status: "waiting" });
    fila({ id: "conectado-anterior", status: "connected" });
    fila({ id: "escaneo-ajeno", status: "opened", organizationId: "org_b" });
    await post();
    expect(dbf.handoffs.map((h) => h.status)).toEqual([
      "connected",
      "opened",
      "waiting",
    ]);
    expect(dbf.handoffs.map((h) => h.id)).toEqual([
      "conectado-anterior",
      "escaneo-ajeno",
      HANDOFF,
    ]);
    expect(dbf.borrados[0]).toContain("org_a");
  });

  it("Zernio caído es 503, no un problema de credenciales", async () => {
    zk.plan["GET /profiles"] = new MetaApiError("boom", { status: 503 });
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("zernio_unavailable");
    expect(dbf.inserts).toHaveLength(0);
  });

  it("una llave maestra que ya no sirve se dice como lo que es", async () => {
    zk.plan["GET /profiles"] = new MetaApiError("invalid api key", { status: 401 });
    const res = await post();
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_token");
  });
});

describe("el GET que sondea el escaneo", () => {
  it("un escaneo de otra tienda no se puede consumir aquí", async () => {
    fila({ organizationId: "org_b" });
    const res = await get(HANDOFF);
    expect(res.status).toBe(404);
    expect(zk.llamadas).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  it("sin handoffId no hay sondeo", async () => {
    const res = await GET(new Request("https://crm.ejemplo.test/api/settings/whatsapp/zernio/handoff"));
    expect(res.status).toBe(422);
  });

  it("mientras no escanea, informa el estado y no guarda nada", async () => {
    fila();
    zk.plan["GET /connect/handoffs/" + HANDOFF] = { status: "waiting", accounts: [] };
    const body = await (await get(HANDOFF)).json();
    expect(body).toEqual({ estado: "waiting" });
    expect(save).not.toHaveBeenCalled();
  });

  it("el paso a abierto se escribe en la fila", async () => {
    fila();
    zk.plan["GET /connect/handoffs/" + HANDOFF] = { status: "opened", accounts: [] };
    const body = await (await get(HANDOFF)).json();
    expect(body).toEqual({ estado: "opened" });
    expect(dbf.updates).toEqual([expect.objectContaining({ status: "opened" })]);
  });

  it("con el escaneo terminado conecta el número y suscribe el webhook", async () => {
    fila();
    zk.plan["GET /connect/handoffs/" + HANDOFF] = {
      status: "connected",
      accounts: [{ id: CUENTA, profileId: PERFIL, username: "+1 849 627 9994" }],
    };
    zk.plan["GET /webhooks/settings"] = { webhooks: [] };
    zk.plan["POST /webhooks/settings"] = { webhook: { secret: "secreto-hmac" } };
    const body = await (await get(HANDOFF)).json();
    expect(body).toMatchObject({ estado: "connected", webhookOk: true });
    expect(body.connection).toMatchObject({
      source: "zernio",
      accountRef: CUENTA,
      displayPhoneNumber: "+1 849 627 9994",
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ accountRef: CUENTA, profileRef: PERFIL, webhookSecret: "secreto-hmac" })
    );
    expect(dbf.updates).toEqual([expect.objectContaining({ status: "connected", accountRef: CUENTA })]);
  });

  it("el número de una tienda ya conectada no cambia de dueño", async () => {
    fila();
    creds.dueñaDelNumero = { organizationId: "org_b" };
    zk.plan["GET /connect/handoffs/" + HANDOFF] = {
      status: "connected",
      accounts: [{ id: CUENTA, profileId: PERFIL, username: "+1 849 627 9994" }],
    };
    const body = await (await get(HANDOFF)).json();
    expect(body.estado).toBe("failed");
    expect(body.codigo).toBe("cuenta_ya_conectada");
    expect(save).not.toHaveBeenCalled();
    expect(dbf.updates).toEqual([expect.objectContaining({ status: "failed" })]);
  });

  it("varias cuentas en un mismo escaneo se rechazan, no se elige al azar", async () => {
    fila();
    zk.plan["GET /connect/handoffs/" + HANDOFF] = {
      status: "connected",
      accounts: [
        { id: CUENTA, profileId: PERFIL, username: "+1 849 627 9994" },
        { id: "otra", profileId: PERFIL, username: "+1 809 000 0000" },
      ],
    };
    const body = await (await get(HANDOFF)).json();
    expect(body.codigo).toBe("connect_incomplete");
    expect(save).not.toHaveBeenCalled();
  });

  it("un fallo de Zernio se responde en español con lo que la persona puede hacer", async () => {
    fila();
    zk.plan["GET /connect/handoffs/" + HANDOFF] = {
      status: "failed",
      accounts: [],
      error: {
        code: "whatsapp_coexistence_not_registered",
        message: "the number is not on the WhatsApp Business app",
        details: { is_user_fixable: "true" },
      },
    };
    const body = await (await get(HANDOFF)).json();
    expect(body.estado).toBe("failed");
    expect(body.loArreglaElUsuario).toBe(true);
    expect(body.mensaje).toContain("WhatsApp Business");
    expect(body.mensaje).not.toMatch(/the number is not/);
    expect(dbf.updates).toEqual([expect.objectContaining({ status: "failed", errorCode: "whatsapp_coexistence_not_registered" })]);
  });

  it("un fallo que nadie arregla desde el teléfono se muestra crudo", async () => {
    fila();
    zk.plan["GET /connect/handoffs/" + HANDOFF] = {
      status: "failed",
      error: { code: "whatsapp_error", message: "Error from Meta: #131026", details: {} },
    };
    const body = await (await get(HANDOFF)).json();
    expect(body.mensaje).toContain("#131026");
  });

  it("un enlace caducado se cierra y no se vuelve a sondear", async () => {
    fila({ status: "expired" });
    const body = await (await get(HANDOFF)).json();
    expect(body.estado).toBe("expired");
    expect(body.mensaje).toContain("30 minutos");
    expect(zk.llamadas).toHaveLength(0);
  });

  it("la rama caducada viene de Zernio y queda escrita", async () => {
    fila();
    zk.plan["GET /connect/handoffs/" + HANDOFF] = { status: "expired" };
    const body = await (await get(HANDOFF)).json();
    expect(body.estado).toBe("expired");
    expect(dbf.updates).toEqual([expect.objectContaining({ status: "expired" })]);
  });

  it("un escaneo ya conectado se replay desde la fila, sin volver a Zernio", async () => {
    fila({ status: "connected", accountRef: CUENTA });
    creds.actuales = {
      source: "zernio",
      accountRef: CUENTA,
      token: env.llaveMaestra,
      status: "connected",
      displayPhoneNumber: "+1 849 627 9994",
      webhookSecret: "secreto-hmac",
    };
    const body = await (await get(HANDOFF)).json();
    expect(body).toMatchObject({ estado: "connected", webhookOk: true });
    expect(body.connection).toMatchObject({ accountRef: CUENTA });
    expect(zk.llamadas).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  it("el cuerpo de una respuesta nunca trae la llave maestra", async () => {
    fila({ status: "connected" });
    creds.actuales = {
      source: "zernio",
      accountRef: CUENTA,
      token: env.llaveMaestra,
      status: "connected",
      displayPhoneNumber: "+1 849 627 9994",
      webhookSecret: "secreto-hmac",
    };
    const texto = await (await get(HANDOFF)).text();
    expect(texto).not.toContain(env.llaveMaestra);
    expect(texto).toContain(env.llaveMaestra.slice(-4));
  });
});
