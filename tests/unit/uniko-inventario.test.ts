import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Existencias vivas desde UNIKO-RD.
 *
 * Lo que se cuida aquí es la promesa del módulo: que NADA de esto pueda tumbar
 * un turno. Una instancia sin las dos variables del entorno no llama a nadie;
 * una tienda sin vincular tampoco; y si Supabase se cae, responde raro o tarda,
 * el turno sale igual como si la función no existiera. La última parte es el
 * bloque que se le pega al modelo: es la foto de AHORA y tiene que decir
 * "AGOTADO" cuando no hay, no callarse.
 */

import {
  inventarioUnikoActivo,
  leerConfigUniko,
  type ConfigUniko,
} from "@/server/uniko/config";
import {
  bloqueDeExistencias,
  buscarExistencias,
  type Existencia,
} from "@/server/uniko/inventario";

type Activa = Extract<ConfigUniko, { active: true }>;
type Apagado = Extract<ConfigUniko, { active: false }>;

const URL_BASE = "http://supabase.internal/rest";
const LLAVE = "anon-key-de-prueba";

const fetchMock = vi.fn();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function conSoloEntorno(env: Record<string, string | undefined>): Activa {
  const c = leerConfigUniko({
    UNIKO_SUPABASE_URL: URL_BASE,
    UNIKO_SUPABASE_ANON_KEY: LLAVE,
    ...env,
  });
  if (!c.active) throw new Error("el config de prueba debería estar activo");
  return c;
}

const APAGADO: Apagado = { active: false, problem: null };

/** Una fila del RPC, tal y como la devuelve Supabase. */
function filaRpc(p: Record<string, unknown> = {}) {
  return {
    id: "prod_1",
    title: "Tenis deportivos para correr",
    sku: null,
    price: 4900,
    tracks_stock: true,
    stock: 3,
    available: true,
    ...p,
  };
}

/** Lo que `buscarExistencias` entrega ya mapeado. */
function existencia(p: Partial<Existencia> = {}): Existencia {
  return {
    id: "prod_1",
    titulo: "Tenis deportivos para correr",
    sku: null,
    precio: 4900,
    unidades: 3,
    disponible: true,
    ...p,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("leerConfigUniko: la bandera de catálogo", () => {
  it("sin las dos variables, apagado y sin problema: la instancia no está en UNIKO", () => {
    expect(leerConfigUniko({})).toEqual(APAGADO);
    expect(leerConfigUniko({ UNIKO_SUPABASE_URL: URL_BASE })).toEqual({
      active: false,
      problem: "sin_llave",
    });
  });

  it("leerConfigUniko mira el entorno que recibe, no el de proceso", () => {
    // `inventarioUnikoActivo()` es la versión sin argumentos: la usan las
    // guardas baratas. Aquí el entorno de la prueba manda.
    const claves = ["UNIKO_SUPABASE_URL", "UNIKO_SUPABASE_ANON_KEY"] as const;
    const antes = claves.map((k) => process.env[k]);
    claves.forEach((k) => delete process.env[k]);
    expect(inventarioUnikoActivo()).toBe(false);
    process.env.UNIKO_SUPABASE_URL = URL_BASE;
    process.env.UNIKO_SUPABASE_ANON_KEY = LLAVE;
    expect(inventarioUnikoActivo()).toBe(true);
    claves.forEach((k, i) => {
      if (antes[i] === undefined) delete process.env[k];
      else process.env[k] = antes[i];
    });
  });

  it("una URL mal escrita o con credenciales dentro apaga, no revienta", () => {
    // Con `.url()` en el esquema del entorno esto tumbaba el CRM entero.
    for (const bruta of ["no-es-una-url", "ftp://supabase:8000", "https://u:p@supabase"]) {
      expect(
        leerConfigUniko({ UNIKO_SUPABASE_URL: bruta, UNIKO_SUPABASE_ANON_KEY: LLAVE })
      ).toEqual({ active: false, problem: "url" });
    }
  });

  it("el RPC se arma sobre el prefijo del proxy, sin dobles barras", () => {
    expect(conSoloEntorno({ UNIKO_SUPABASE_URL: `${URL_BASE}/` }).rpcUrl).toBe(
      `${URL_BASE}/rest/v1/rpc/crm_search_products`
    );
    // Un Supabase detrás de un proxy con path: el path es parte del proyecto.
    expect(conSoloEntorno({ UNIKO_SUPABASE_URL: "https://gateway.example/supabase/" }).rpcUrl).toBe(
      "https://gateway.example/supabase/rest/v1/rpc/crm_search_products"
    );
  });

  it("la web de los enlaces sale del entorno y viene sin barra final", () => {
    expect(conSoloEntorno({ UNIKO_WEB_URL: "https://uniko.example.do/" }).webBase).toBe(
      "https://uniko.example.do"
    );
    // Sin la variable, el dominio público: estos enlaces los ve el cliente.
    expect(conSoloEntorno({}).webBase).toBe("https://uniko-rd.com");
  });
});

describe("buscarExistencias: las guardas antes de tocar la red", () => {
  it("sin config, sin tienda o sin texto: cero llamadas", async () => {
    expect(await buscarExistencias("store_1", "tenis", APAGADO)).toEqual({
      ok: false,
      motivo: "sin_config",
    });

    const config = conSoloEntorno({});
    for (const storeId of [null, undefined, "  "]) {
      expect(await buscarExistencias(storeId, "tenis", config)).toEqual({
        ok: false,
        motivo: "sin_config",
      });
    }
    for (const texto of [null, undefined, "   "]) {
      expect(await buscarExistencias("store_1", texto, config)).toEqual({
        ok: false,
        motivo: "sin_texto",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("manda la tienda, la consulta y el límite, firmada con la anon", async () => {
    fetchMock.mockResolvedValueOnce(json({ products: [] }));
    expect(await buscarExistencias("store_9", "  tenis  ", conSoloEntorno({}))).toEqual({
      ok: true,
      productos: [],
    });

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe(`${URL_BASE}/rest/v1/rpc/crm_search_products`);
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe(LLAVE);
    expect(init.headers.Authorization).toBe(`Bearer ${LLAVE}`);
    expect(JSON.parse(String(init.body))).toEqual({
      p_store_id: "store_9",
      p_query: "tenis",
      p_limit: 6,
    });
  });

  it("un producto sin control de existencias se guarda sin número", async () => {
    fetchMock.mockResolvedValueOnce(json({ products: [filaRpc({ tracks_stock: false })] }));
    expect(await buscarExistencias("store_1", "tenis", conSoloEntorno({}))).toEqual({
      ok: true,
      productos: [existencia({ unidades: null })],
    });
  });

  it("nunca lanza: si la red falla, responde mal o no es JSON, dice `error`", async () => {
    const config = conSoloEntorno({});

    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await buscarExistencias("store_1", "tenis", config)).toEqual({
      ok: false,
      motivo: "error",
    });

    fetchMock.mockResolvedValueOnce(json({ message: "relation does not exist" }, 500));
    expect(await buscarExistencias("store_1", "tenis", config)).toEqual({
      ok: false,
      motivo: "error",
    });

    fetchMock.mockResolvedValueOnce(new Response("<html>502</html>", { status: 200 }));
    expect(await buscarExistencias("store_1", "tenis", config)).toEqual({
      ok: false,
      motivo: "error",
    });

    // 200 con una forma que no es la del RPC: mejor no inventar.
    fetchMock.mockResolvedValueOnce(json({ products: [{ id: 12345 }] }));
    expect(await buscarExistencias("store_1", "tenis", config)).toEqual({
      ok: false,
      motivo: "error",
    });
  });
});

describe("bloqueDeExistencias: lo que lee el modelo", () => {
  it("sin coincidencias no hay bloque: nada que pegar al prompt", () => {
    expect(bloqueDeExistencias({ ok: true, productos: [] }, conSoloEntorno({}))).toBeNull();
    expect(bloqueDeExistencias({ ok: false, motivo: "error" }, conSoloEntorno({}))).toBeNull();
  });

  it("un config apagado tampoco deja bloque", () => {
    expect(bloqueDeExistencias({ ok: true, productos: [existencia()] }, APAGADO)).toBeNull();
  });

  it("dice cuántos quedan, el precio y el enlace de la ficha", () => {
    const bloque = bloqueDeExistencias({ ok: true, productos: [existencia()] }, conSoloEntorno({}));
    expect(bloque).toContain("quedan 3");
    expect(bloque).toContain("RD$4,900");
    expect(bloque).toContain("https://uniko-rd.com/productos/prod_1");
    expect(bloque).toContain("no inventes existencia");
  });

  it("agotado y sin control se escriben con palabras distintas", () => {
    const agotado = bloqueDeExistencias(
      { ok: true, productos: [existencia({ unidades: 0, disponible: false })] },
      conSoloEntorno({})
    );
    expect(agotado).toContain("AGOTADO");
    expect(agotado).not.toContain("quedan 0");

    const libre = bloqueDeExistencias(
      { ok: true, productos: [existencia({ unidades: null })] },
      conSoloEntorno({})
    );
    expect(libre).toContain("inventario no controlado");
  });

  it("el precio lleva separador de millares y los enlaces usan la web configurada", () => {
    const bloque = bloqueDeExistencias(
      { ok: true, productos: [existencia({ precio: 125000 })] },
      { ...conSoloEntorno({}), webBase: "https://tienda.example" }
    );
    // `es-DO` agrupa con coma; con ICU reducido Node cae a `en-US` y la coma
    // sale igual, así que el bloque no depende de qué ICU traiga el contenedor.
    expect(bloque).toMatch(/RD\$125[,.]000/);
    expect(bloque).toContain("https://tienda.example/productos/prod_1");
  });
});
