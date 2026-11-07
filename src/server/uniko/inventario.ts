import { z } from "zod";
import { leerConfigUniko, type ConfigUniko } from "./config";

/**
 * Existencias vivas de la tienda, leídas en el momento del turno.
 *
 * El knowledge base ya trae un bloque de catálogo que el kb-sync regenera cada
 * 15 minutos; ese bloque es la foto y este dato es el termómetro. Un pedido
 * hecho hace dos minutos deja el bloque diciendo "quedan 4" cuando ya no queda
 * nada, y el bot lo repite. Se consultan SOLO las coincidencias con el mensaje
 * entrante — el RPC puntúa y acota — para no inflar el prompt con el catálogo
 * entero.
 *
 * Cualquier fallo (red, respuesta rara, tiempo) devuelve `null` y el turno sale
 * como si la función no existiera: preferible a quedarse mudo porque Supabase
 * tardó.
 */

/** La llamada es interna y en la misma máquina: 1,2 s es generoso y acota el turno. */
const TIMEOUT_MS = 1_200;
const LIMITE = 6;

const RpcProducto = z.object({
  id: z.string(),
  title: z.string(),
  sku: z.string().nullish(),
  price: z.coerce.number(),
  tracks_stock: z.boolean(),
  stock: z.coerce.number().nullish(),
  available: z.boolean(),
});

const RpcRespuesta = z.object({
  products: z.array(RpcProducto).default([]),
});

export type Existencia = {
  id: string;
  titulo: string;
  sku: string | null;
  precio: number;
  /** `null`: la tienda no lleva existencias de este producto. */
  unidades: number | null;
  disponible: boolean;
};

export type BusquedaUniko =
  | { ok: true; productos: Existencia[] }
  | { ok: false; motivo: "sin_config" | "error" };

function existeConfig(config: ConfigUniko): config is Extract<ConfigUniko, { active: true }> {
  return config.active;
}

/**
 * Busca en el catálogo de LA tienda de esta organización. `storeId` viene de
 * `organization.uniko_store_id`; sin valor, no se llama a nadie.
 */
export async function buscarExistencias(
  storeId: string | null | undefined,
  consulta: string | null | undefined,
  config: ConfigUniko = leerConfigUniko()
): Promise<BusquedaUniko> {
  if (!existeConfig(config)) return { ok: false, motivo: "sin_config" };
  if (!storeId?.trim()) return { ok: false, motivo: "sin_config" };
  // Vacío = una muestra del catálogo (el RPC no filtra): sirve cuando el
  // mensaje no nombra ningún producto ("¿qué venden?").
  const texto = consulta?.trim() ?? "";

  let res: Response;
  try {
    res = await fetch(config.rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
      },
      body: JSON.stringify({
        p_store_id: storeId,
        p_query: texto,
        p_limit: LIMITE,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`[uniko] no pude consultar existencias: ${err}`);
    return { ok: false, motivo: "error" };
  }
  if (!res.ok) {
    console.warn(`[uniko] existencias respondieron ${res.status}`);
    return { ok: false, motivo: "error" };
  }

  const cuerpo = await res.json().catch((err: unknown) => {
    console.warn(`[uniko] respuesta de existencias ilegible: ${err}`);
    return null;
  });
  const analizado = RpcRespuesta.safeParse(cuerpo);
  if (!analizado.success) {
    console.warn(`[uniko] forma inesperada en existencias: ${analizado.error.issues[0]?.message}`);
    return { ok: false, motivo: "error" };
  }

  return {
    ok: true,
    productos: analizado.data.products.map((p) => ({
      id: p.id,
      titulo: p.title,
      sku: p.sku ?? null,
      precio: p.price,
      unidades: p.tracks_stock ? (p.stock ?? null) : null,
      disponible: p.available,
    })),
  };
}

const precioRd = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 });

function lineaDe(p: Existencia, webBase: string): string {
  const estado = !p.disponible
    ? "AGOTADO"
    : p.unidades === null
      ? "inventario no controlado"
      : `quedan ${p.unidades}`;
  return `- ${p.titulo} | RD$${precioRd.format(p.precio)} | ${estado} | ${webBase}/productos/${p.id}`;
}

/**
 * El bloque que se pega al final del turno, junto al mapa de huecos de la
 * agenda: es el estado de AHORA, y enterrado antes del historial el modelo lo
 * lee como historia vieja.
 */
export function bloqueDeExistencias(
  busqueda: BusquedaUniko,
  config: ConfigUniko = leerConfigUniko(),
  /** `true`: el mensaje no coincidió con nada y esto es una muestra del catálogo. */
  muestra = false
): string | null {
  if (!busqueda.ok || busqueda.productos.length === 0) return null;
  if (!config.active) return null;
  const lineas = busqueda.productos.map((p) => lineaDe(p, config.webBase));
  if (muestra) {
    return [
      "ALGUNOS PRODUCTOS DEL CATÁLOGO DE LA TIENDA EN ESTE INSTANTE (el mensaje no nombró ninguno en concreto):",
      ...lineas,
      "Úsalos para orientar al cliente. Si busca algo que no aparece aquí, no inventes: ofrécele el enlace de la tienda o confirmarlo con la tienda.",
    ].join("\n");
  }
  return [
    "EXISTENCIAS EN ESTE INSTANTE, consultadas al sistema de la tienda al llegar el mensaje. Mandan sobre cualquier cifra del conocimiento del negocio si difieren:",
    ...lineas,
    "Si el cliente pregunta por disponibilidad, da este número. Un producto que no está en esta lista no está en el catálogo: no inventes existencia, ofrece confirmarlo con la tienda.",
  ].join("\n");
}

const RestTienda = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  location: z.string().nullish(),
  verified: z.boolean().nullish(),
});
export type PerfilTienda = z.infer<typeof RestTienda>;

/**
 * El perfil público de la tienda en UNIKO-RD. `null` = no existe o aún no está
 * aprobada (las RLS no la entregan); `"error"` = no se pudo preguntar.
 */
export async function perfilDeTienda(
  storeId: string,
  config: ConfigUniko = leerConfigUniko()
): Promise<PerfilTienda | null | "error"> {
  if (!existeConfig(config)) return "error";
  try {
    const res = await fetch(
      `${config.storesUrl}?id=eq.${encodeURIComponent(storeId)}&select=id,name,description,category,location,verified&limit=1`,
      {
        headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const filas = z.array(RestTienda).safeParse(await res.json());
    if (!filas.success) throw new Error(filas.error.issues[0]?.message);
    return filas.data[0] ?? null;
  } catch (err) {
    console.warn(`[uniko] no pude leer el perfil de la tienda: ${err}`);
    return "error";
  }
}

/** Quién es la tienda, para que el bot pueda presentarla y mandar su enlace. */
export function bloqueDeTienda(
  perfil: PerfilTienda | null | "error",
  config: ConfigUniko = leerConfigUniko()
): string | null {
  if (!perfil || perfil === "error" || !config.active) return null;
  return [
    "PERFIL DE ESTE NEGOCIO EN UNIKO-RD (el marketplace donde vende):",
    `- Nombre: ${perfil.name}${perfil.verified ? " (tienda verificada)" : ""}`,
    perfil.description && `- Qué es: ${perfil.description}`,
    perfil.category && `- Categoría: ${perfil.category}`,
    perfil.location && `- Ubicación: ${perfil.location}`,
    `- Tienda en línea: ${config.webBase}/tiendas/${perfil.id}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * ¿`email` es el dueño de la tienda en UNIKO-RD? Lo responde el RPC
 * `crm_store_owner_matches` (migración v14 de la web), que solo dice sí/no y
 * nunca entrega el correo. `"error"` = no se pudo preguntar.
 */
export async function esDuenoDeTienda(
  storeId: string,
  email: string,
  config: ConfigUniko = leerConfigUniko()
): Promise<boolean | "error"> {
  if (!existeConfig(config)) return "error";
  try {
    const res = await fetch(config.duenoUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
      },
      body: JSON.stringify({ p_store_id: storeId, p_email: email }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = (await res.json()) as unknown;
    if (typeof r !== "boolean") throw new Error("respuesta no booleana");
    return r;
  } catch (err) {
    console.warn(`[uniko] no pude comprobar el dueño de la tienda: ${err}`);
    return "error";
  }
}
