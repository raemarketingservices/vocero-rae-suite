import { randomBytes } from "node:crypto";
import { MetaApiError } from "@/lib/meta/client";
import {
  getCredentialsByAccountRef,
  getCredentialsByOrg,
  hablaPorZernio,
  saveCredentials,
  tokenLast4,
} from "@/server/whatsapp/credentials";
import { webhookUrl } from "@/server/whatsapp/webhook-url";
import { listZernioAccounts, zernioFetch, type ZernioAccount } from "@/server/zernio";

/**
 * 025 — Conectar un número escaneando un QR, con la llave maestra de RAE.
 *
 * El modo viejo de esta tarjeta pedía dos cosas que el dueño de una tienda no
 * tiene: una cuenta de Zernio y saber dónde está su API key. Aquí el CRM hace
 * de cuenta de Zernio con SU llave (`ZERNIO_MASTER_API_KEY`), que nunca baja al
 * navegador, y al cliente solo le queda escanear.
 *
 * Tres piezas lo sostienen, y viven juntas porque fallan juntas:
 * - **un perfil por tienda**: Zernio aísla números POR PERFIL, y `externalId`
 *   está pensado justamente para mapear un tenant propio sin guardar el id de
 *   Zernio. Sin esto, dos tiendas peleadas por el mismo número no se pueden
 *   distinguir ni al conectar ni al recibir un evento.
 * - **el handoff**: `GET /connect/whatsapp?handoff=true` devuelve un link corto
 *   de 30 minutos que abre la pantalla de autorización en el teléfono del
 *   dueño. No hay videollamada ni pantallas compartidas.
 * - **la suscripción del webhook**: un número conectado y no suscrito no recibe
 *   nada, y el fallo es silencioso (la ruta responde 200). Por eso el alta lo
 *   hace el CRM, no una persona en el panel de Zernio.
 */

const ZERNIO_PATH_CONNECT = "/connect/whatsapp";

/** Lo que el CRM suscribe: los cuatro eventos que su ingest sabe leer. */
const WEBHOOK_EVENTS = [
  "message.received",
  "message.delivered",
  "message.read",
  "message.failed",
] as const;

export type PerfilZernio = { id: string; name: string };

/**
 * El perfil de una organización, creándolo si no existe.
 *
 * Se busca por `externalId`, no por nombre: el nombre de la tienda lo puede
 * cambiar quien sea, y un perfil duplicado con el número dentro sería
 * inconcebible de limpiar desde el CRM.
 */
export async function perfilDeOrg(
  token: string,
  input: { organizationId: string; name: string }
): Promise<PerfilZernio> {
  const existentes = await listaPerfiles(token, input.organizationId);
  const ya = existentes.find((p) => p.externalId === input.organizationId);
  if (ya) return { id: ya._id, name: ya.name ?? input.name };

  try {
    const res = await zernioFetch("/profiles", {
      method: "POST",
      token,
      // Un timeout aquí deja el perfil creado sin respuesta; la misma clave de
      // idempotencia hace que el reintento devuelva el de antes en vez de un
      // segundo perfil huérfano.
      headers: { "Idempotency-Key": input.organizationId },
      body: { name: input.name.slice(0, 60), externalId: input.organizationId },
    });
    const creado = (res as { profile?: { _id?: string } } | null)?.profile;
    if (creado?._id) return { id: creado._id, name: input.name };
  } catch (err) {
    // 409 = ya existe (el reintento de un create que sí había funcionado).
    if (!esConflicto(err)) throw err;
  }

  const trasCreate = await listaPerfiles(token, input.organizationId);
  const recuperado = trasCreate.find((p) => p.externalId === input.organizationId);
  if (!recuperado) {
    throw new MetaApiError("Zernio no devolvió el perfil de esta tienda", {
      status: 502,
    });
  }
  return { id: recuperado._id, name: recuperado.name ?? input.name };
}

type PerfilCrudo = { _id: string; name?: string | null; externalId?: string | null };

async function listaPerfiles(token: string, externalId: string): Promise<PerfilCrudo[]> {
  const res = await zernioFetch(
    `/profiles?externalId=${encodeURIComponent(externalId)}`,
    { token }
  );
  const rows = (res as { profiles?: unknown[] } | null)?.profiles ?? [];
  return rows.filter(
    (r): r is PerfilCrudo =>
      !!r && typeof (r as PerfilCrudo)._id === "string" && (r as PerfilCrudo)._id !== ""
  );
}

function esConflicto(err: unknown): boolean {
  return err instanceof MetaApiError && err.status === 409;
}

/** Una cuenta recién conectada, en lo que el CRM necesita para guardarla. */
export type CuentaConectada = {
  id: string;
  /** El número tal como lo ve Zernio (`+1849…`), o su nombre de pantalla. */
  label: string | null;
};

export type InicioHandoff =
  /** Hay que escanear: el link caduca a los 30 minutos. */
  | { modo: "qr"; handoffId: string; url: string; expiresAt: string | null }
  /**
   * Zernio reactivó una cuenta desconectada de este perfil y devolvió la cuenta
   * en vez de un link. No hay QR que mostrar: se conecta aquí mismo.
   */
  | { modo: "connected"; cuenta: CuentaConectada };

/**
 * Arranca la conexión del número de esta tienda.
 *
 * `onboarding=business_app` es el corazón del argumento de venta: es la
 * coexistencia, o sea que el número sigue estando en la app de WhatsApp
 * Business del dueño y nada se porta ni se transfiere. Con `api` sería un alta
 * de Cloud API y el número acabaría colgado de un WABA.
 *
 * `handoff=true` no se combina con `redirect_url`, `headless` ni `signup` (Zernio
 * responde 400), así que estos parámetros van escritos y no desde la UI.
 */
export async function iniciarConexion(
  token: string,
  input: {
    profileId: string;
    brandName: string;
    /** Id de cuenta para reconectar la misma que ya estaba desconectada. */
    reconnectAccountId?: string | null;
  }
): Promise<InicioHandoff> {
  const q = new URLSearchParams({
    profileId: input.profileId,
    handoff: "true",
    // `brandName` solo se acepta con `signup=hosted` o `welcome=true`, y el
    // handoff abre la pantalla de bienvenida en el teléfono de todos modos.
    // Escribirla es lo que hace que el nombre de la tienda llegue al pantallazo
    // en vez del logo de Zernio.
    welcome: "true",
    onboarding: "business_app",
    brandName: input.brandName.slice(0, 60),
  });
  if (input.reconnectAccountId) q.set("reconnectAccountId", input.reconnectAccountId);

  const res = (await zernioFetch(`${ZERNIO_PATH_CONNECT}?${q.toString()}`, {
    token,
  })) as {
    handoff?: { id?: string; url?: string; expiresAt?: string };
    account?: Record<string, unknown>;
  } | null;

  const h = res?.handoff;
  if (h?.id && h.url) {
    return { modo: "qr", handoffId: h.id, url: h.url, expiresAt: h.expiresAt ?? null };
  }
  const cuenta = parseCuenta(res?.account);
  if (cuenta) return { modo: "connected", cuenta };

  throw new MetaApiError("Zernio no devolvió ni un link de escaneo ni una cuenta", {
    status: 502,
    details: res,
  });
}

export type EstadoHandoff =
  | { estado: "waiting" }
  | { estado: "opened" }
  | { estado: "connected"; cuentas: CuentaConectada[] }
  | { estado: "failed"; codigo: string; mensaje: string; loArreglaElUsuario: boolean }
  | { estado: "expired" };

/**
 * En qué quedó el escaneo.
 *
 * Los estados son los de Zernio, sin traducir: son el valor de una columna y a
 * la vez lo que entiende el navegador, y tener dos vocabularios para la misma
 * cosa es tener dos formas de equivocarse. Lo que sí se traduce es el motivo de
 * un fallo, y se hace en la ruta, que es donde lo va a leer una persona.
 */
export async function estadoHandoff(
  token: string,
  handoffId: string
): Promise<EstadoHandoff> {
  const res = (await zernioFetch(
    `/connect/handoffs/${encodeURIComponent(handoffId)}`,
    { token }
  )) as {
    status?: string;
    accounts?: unknown[];
    error?: {
      code?: string;
      message?: string | null;
      details?: Record<string, string> | null;
    } | null;
  } | null;

  const status = (res?.status ?? "").toLowerCase();
  if (status === "connected") {
    const cuentas = (res?.accounts ?? [])
      .map(parseCuenta)
      .filter((c): c is CuentaConectada => c !== null);
    return { estado: "connected", cuentas };
  }
  if (status === "expired") return { estado: "expired" };
  if (status === "failed") {
    const e = res?.error ?? {};
    return {
      estado: "failed",
      codigo: e.code ?? "connect_incomplete",
      mensaje: e.message ?? "",
      loArreglaElUsuario: e.details?.is_user_fixable === "true",
    };
  }
  if (status === "opened") return { estado: "opened" };
  return { estado: "waiting" };
}

function parseCuenta(raw: unknown): CuentaConectada | null {
  // El `account` del connect es un `SocialAccount` completo y viene con `_id`;
  // los `accounts[]` de un handoff conectado son una proyección corta
  // (`id`, `profileId`, `username`). Un solo lector para las dos formas, porque
  // confundirlas es conectar nada con un id que Zernio nunca devolvió.
  const r = raw as Partial<Record<string, unknown>> & {
    metadata?: Partial<Record<string, unknown>>;
  } | null;
  const id =
    (typeof r?.id === "string" && r.id) ||
    (typeof r?._id === "string" && r._id) ||
    null;
  if (!id) return null;
  const numero =
    (typeof r?.metadata?.displayPhoneNumber === "string"
      ? r.metadata.displayPhoneNumber
      : null) ??
    (typeof r?.username === "string" && r.username.startsWith("+") ? r.username : null);
  const nombre = typeof r?.displayName === "string" ? r.displayName : null;
  return { id, label: numero ?? nombre ?? (typeof r?.username === "string" ? r.username : null) };
}

/**
 * El webhook de esta instancia, dado de alta si falta.
 *
 * Se crea UNA suscripción por cuenta de Zernio (la de RAE), apuntando a la URL
 * fija del CRM: el reparto a la tienda ya lo hace el `account.id` del evento,
 * así que suscribir número por número sería N webhooks entregando lo mismo.
 * Devuelve su secreto, que se guarda POR ORGANIZACIÓN porque así lo busca el
 * ingest al verificar la firma (`resolveZernioSecret`).
 */
export async function asegurarWebhook(token: string): Promise<string | null> {
  const url = webhookUrl("wa");
  const existentes = await zernioFetch("/webhooks/settings", { token }).catch(() => null);
  const lista =
    (existentes as { webhooks?: Record<string, unknown>[] } | null)?.webhooks ?? [];
  const ya = lista.find((w) => w.url === url);
  if (ya) return typeof ya.secret === "string" ? ya.secret : null;

  const nombre = new URL(url).host.slice(0, 40);
  const res = await zernioFetch("/webhooks/settings", {
    method: "POST",
    token,
    body: {
      name: `vocero-${nombre}`.slice(0, 50),
      url,
      events: [...WEBHOOK_EVENTS],
      secret: randomBytes(32).toString("hex"),
      isActive: true,
    },
  });
  const creado = (res as { webhook?: { secret?: unknown } } | null)?.webhook;
  return typeof creado?.secret === "string" ? creado.secret : null;
}

/** Lo que la tarjeta necesita para pintarse a sí misma. */
export type ConnectionPintada = {
  source: "zernio";
  accountRef: string | null;
  displayPhoneNumber: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

export type ResultadoConexion =
  | { ok: true; connection: ConnectionPintada; webhookOk: boolean }
  | { ok: false; status: number; code: string; message: string };

/**
 * Guarda la conexión de un número, con las dos guardas que no se negocian.
 *
 * La primera es la de siempre: un número, una tienda. Con la llave maestra es
 * más importante que nunca, porque esa llave lista los números de TODAS las
 * tiendas — sin esta guarda, la tienda B conectaría el número de la A y una de
 * las dos bandejas dejaría de recibir mensajes sin que nada lo diga en pantalla.
 *
 * La segunda es que el número no esté ya en la Cloud API de Meta en esta
 * instancia: dos fuentes para el mismo teléfono es un reparto indeterminado.
 *
 * Es el mismo camino para el modo QR y para el de pegar la llave, y por eso
 * vive aquí y no dentro de la ruta.
 */
export async function conectarCuenta(input: {
  organizationId: string;
  token: string;
  cuenta: CuentaConectada;
  profileId?: string | null;
}): Promise<ResultadoConexion> {
  const actual = await getCredentialsByOrg(input.organizationId);
  if (actual && !hablaPorZernio(actual)) {
    return {
      ok: false,
      status: 409,
      code: "canal_meta",
      message:
        "Este número está conectado con la Cloud API de Meta; desconéctalo antes de pasarlo a Zernio",
    };
  }
  const dueña = await getCredentialsByAccountRef(input.cuenta.id);
  if (dueña && dueña.organizationId !== input.organizationId) {
    return {
      ok: false,
      status: 409,
      code: "cuenta_ya_conectada",
      message:
        "Ese número de Zernio ya está conectado a otra tienda. Desconéctalo allí antes de traerlo aquí.",
    };
  }

  const numero = await etiquetaDelNumero(input.token, input.cuenta);
  const suscripcion = await asegurarWebhook(input.token).catch((err) => {
    console.warn("[zernio] no se pudo dejar suscrito el webhook:", err);
    return null;
  });

  await saveCredentials({
    organizationId: input.organizationId,
    source: "zernio",
    wabaId: null,
    phoneNumberId: null,
    accountRef: input.cuenta.id,
    profileRef: input.profileId ?? null,
    webhookSecret: suscripcion,
    token: input.token,
    displayPhoneNumber: numero,
    verifiedName: null,
  });

  return {
    ok: true,
    webhookOk: suscripcion !== null,
    connection: {
      source: "zernio",
      accountRef: input.cuenta.id,
      displayPhoneNumber: numero,
      status: "connected",
      tokenLast4: tokenLast4(input.token),
    },
  };
}

/**
 * El número en pantalla.
 *
 * El handoff solo trae `username`, y con la llave maestra eso puede ser un id
 * en vez del teléfono. Se intenta la lista de cuentas (que sí trae
 * `displayPhoneNumber`) y si Zernio no colabora se usa lo que vino del handoff:
 * mejor un número mal rotulado que ninguno.
 */
async function etiquetaDelNumero(
  token: string,
  cuenta: CuentaConectada
): Promise<string | null> {
  if (cuenta.label?.startsWith("+")) return cuenta.label;
  const cuentas = await listZernioAccounts(token, "whatsapp", { sandbox: true }).catch(
    () => [] as ZernioAccount[]
  );
  const encontrada = cuentas.find((c) => c.id === cuenta.id);
  return encontrada?.phoneNumber ?? encontrada?.name ?? cuenta.label ?? null;
}

/**
 * Traduce el fallo de Zernio al código que entiende la tarjeta.
 *
 * `402` va con las de autenticación a propósito: Zernio corta una cuenta sin
 * método de pago, y para quien conecta es lo mismo que una llave que no sirve
 * — lo que no puede ser es que se lo trague un 500.
 */
export function errorDeZernio(err: unknown): Response {
  if (err instanceof MetaApiError) {
    if (err.isAuthError || err.status === 402) {
      return Response.json(
        {
          error: {
            code: "invalid_token",
            message:
              err.status === 402
                ? "Zernio rechaza la cuenta: está pausada o sin método de pago"
                : "La API key de Zernio no es válida",
          },
        },
        { status: 422 }
      );
    }
    if (err.status === 0 || err.status >= 500) {
      return Response.json(
        {
          error: {
            code: "zernio_unavailable",
            message: "Zernio no respondió; intenta de nuevo en un momento",
          },
        },
        { status: 503 }
      );
    }
    return Response.json(
      { error: { code: "conexion_rechazada", message: err.message } },
      { status: 422 }
    );
  }
  console.error("[zernio] fallo no clasificado:", err);
  return Response.json(
    { error: { code: "internal", message: "No se pudo verificar la conexión" } },
    { status: 500 }
  );
}
