/**
 * UNIKO-RD — ¿está esta instancia conectada al catálogo de una tienda?
 *
 * Mismo trato que la agenda (ADR-002) y los canales (ADR-001): el código viaja
 * siempre y lo que decide si EXISTE es el entorno. Sin las dos variables, el
 * turno del agente no llama a nadie y sigue contestando solo con el knowledge
 * base de la organización.
 *
 * Se lee `process.env` directo, sin `getEnv()`, como `agendaEnabled()`:
 * preguntar si una función existe no puede depender de que todo el entorno
 * valide. Una URL mal escrita deja la superficie inactiva, no tumba el CRM.
 *
 * La llave que acompaña es la ANON del proyecto — la misma que lleva el
 * navegador de la tienda—. Lo que acota qué se ve son las RLS de Supabase
 * (una tienda aún no aprobada no entrega productos), no un secreto del CRM.
 */

const UNIKO_WEB_POR_DEFECTO = "https://uniko-rd.com";

export type ProblemaUniko =
  /** Faltan las dos variables, o `UNIKO_SUPABASE_URL` no es http(s). */
  | "url"
  /** Hay URL pero no llave anon. */
  | "sin_llave";

export type ConfigUniko =
  | { active: true; rpcUrl: string; anonKey: string; webBase: string }
  | { active: false; problem: ProblemaUniko | null };

type Entorno = Record<string, string | undefined>;

/** Pura sobre el entorno que recibe: la usan el turno, `/api/health` y la tarjeta. */
export function leerConfigUniko(env: Entorno = process.env): ConfigUniko {
  const raw = env.UNIKO_SUPABASE_URL?.trim();
  if (!raw) return { active: false, problem: null };

  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    return { active: false, problem: "url" };
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { active: false, problem: "url" };
  }
  if (base.username || base.password) {
    return { active: false, problem: "url" };
  }

  const anonKey = env.UNIKO_SUPABASE_ANON_KEY?.trim();
  if (!anonKey) return { active: false, problem: "sin_llave" };

  const web = env.UNIKO_WEB_URL?.trim();
  const sinBarra = base.href.replace(/\/+$/, "");
  return {
    active: true,
    // PostgREST: un RPC se llama por POST a esta ruta del proyecto. Se conserva
    // el path si el Supabase está detrás de un proxy con prefijo.
    rpcUrl: `${sinBarra}/rest/v1/rpc/crm_search_products`,
    anonKey,
    webBase: (web ?? UNIKO_WEB_POR_DEFECTO).replace(/\/+$/, ""),
  };
}

export function inventarioUnikoActivo(): boolean {
  return leerConfigUniko().active;
}

/**
 * Respuesta para la superficie de existencias apagada. 404 y no 403, como la
 * agenda (ADR-002) y `ATRIBUCION`: sin URL ni llave anon en el despliegue,
 * vincular una tienda no sirve de nada y el endpoint no existe.
 */
export function inventarioUnikoDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
