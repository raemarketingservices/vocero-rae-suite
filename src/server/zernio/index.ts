import { createHmac, timingSafeEqual } from "node:crypto";
import { MetaApiError } from "@/lib/meta/client";

/**
 * 017 — Transporte de Zernio, compartido por los canales que lo usan.
 *
 * Zernio es una API unificada: UNA cuenta y UNA llave entregan los mensajes de
 * todas las plataformas conectadas (Instagram, Facebook/Messenger, X…) por el
 * mismo webhook, y se responde por el mismo endpoint de conversaciones. Lo que
 * distingue el canal es `account.platform`, y lo que enruta a la organización
 * es `account.id`.
 *
 * Esto vive aparte de cada canal a propósito: la verificación de la firma es
 * un control de seguridad, y dos implementaciones del mismo control son dos
 * sitios donde equivocarse. El canal decide QUÉ plataforma acepta; este módulo
 * resuelve CÓMO se habla con Zernio.
 */

export const ZERNIO_BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";

/** Cabeceras con las que Zernio firma sus entregas (la segunda es heredada). */
const SIGNATURE_HEADERS = ["x-zernio-signature", "x-late-signature"] as const;

export function zernioSignatureFrom(headers: Headers): string | null {
  for (const h of SIGNATURE_HEADERS) {
    const value = headers.get(h);
    if (value) return value;
  }
  return null;
}

/**
 * Firma de Zernio: HMAC-SHA256 en hex del cuerpo CRUDO, con el secreto de esa
 * cuenta. Sin secreto configurado la capa queda desactivada y protege solo el
 * segmento secreto de la URL — mismo trato que da el webhook de WhatsApp a
 * `META_APP_SECRET`.
 */
export function isValidZernioSignature(
  rawBody: string,
  signature: string | null,
  secret: string | null
): boolean {
  if (!secret) return true;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** El evento de Zernio, en lo que a Vocero le importa. */
export type ZernioEvent = {
  id?: string;
  event?: string;
  message?: {
    /**
     * Id de Zernio, NO el de la plataforma (ese viene en
     * `platformMessageId`). Es el que dedupe: se mantiene entre reentregas
     * del mismo mensaje, que es justo lo que hay que colapsar.
     */
    id?: string;
    platformMessageId?: string;
    /**
     * Identificador OPACO del hilo. La propia API dice «format not to be
     * assumed»: su endpoint de respuesta lo acepta verbatim, ya venga del
     * listado o de aquí. No se parsea ni se compara con el de la plataforma.
     */
    conversationId?: string;
    direction?: string;
    text?: string | null;
    /** Cuándo lo mandó la persona, ISO-8601. Ver `zernioSentAtSeconds`. */
    sentAt?: string;
    attachments?: {
      type?: string;
      url?: string;
      mimeType?: string;
      /** WhatsApp: `voice: true` en un audio lo hace nota de voz. */
      payload?: { voice?: boolean } | null;
    }[];
    sender?: {
      id?: string;
      name?: string | null;
      username?: string | null;
      /** WhatsApp: E.164 con `+`; nulo durante el despliegue de BSUID. */
      phoneNumber?: string | null;
      /** WhatsApp: ancla de identidad recomendada por Meta. */
      businessScopedUserId?: string | null;
    };
  };
  account?: { id?: string; platform?: string };
  /**
   * Solo en `message.delivered` / `message.read` / `message.failed`: cuándo lo
   * reportó la plataforma, ISO-8601.
   */
  statusAt?: string;
  /** Solo en `message.failed`: `code`, `title` y `message` de la plataforma. */
  error?: { code?: number; title?: string; message?: string } | null;
};

/**
 * Hora del mensaje en segundos, la que trae el evento y no la de llegada.
 *
 * Importa porque `lastInboundAt` es lo que abre la ventana de 24 h: sellar con
 * la hora de ingesta haría que una reentrega tardía —Zernio reintenta con
 * backoff de hasta 24 h, y su panel permite reenviar a mano— pareciera un
 * mensaje recién llegado, y el CRM ofrecería escribir libre por una ventana
 * que en realidad ya se cerró. El envío lo rechazaría la plataforma, y el
 * operador no tendría forma de entender por qué.
 *
 * Sin `sentAt` utilizable se cae a la hora actual: es lo que había antes y
 * nunca es peor.
 */
export function zernioSentAtSeconds(sentAt: string | undefined): string {
  const ms = sentAt ? Date.parse(sentAt) : NaN;
  return String(Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000));
}

/** Lee el cuerpo crudo como evento de Zernio; null si no lo es. */
export function parseZernioEvent(rawBody: string): ZernioEvent | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const evt = parsed as ZernioEvent;
    // Un payload de Meta trae `object`; uno de Zernio trae `account`. Sin
    // `account` no hay a quién enrutar, así que no es un evento utilizable.
    return evt.account ? evt : null;
  } catch {
    return null;
  }
}

/** `true` si el cuerpo es un webhook de Meta (y por tanto NO de Zernio). */
export function looksLikeMetaPayload(payload: unknown, object: string): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { object?: string }).object === object
  );
}

export type ZernioSendResult = { platformMessageId: string };

/**
 * Id del mensaje en la respuesta de envío.
 *
 * Zernio responde `{ success, data: { messageId } }` y ese `messageId` es el
 * id DE LA PLATAFORMA (el `wamid` en WhatsApp), que es exactamente lo que
 * después traen los `message.delivered`/`read`/`failed`: perderlo deja el
 * mensaje con el reloj puesto para siempre, porque ningún acuse lo encuentra.
 * Las otras dos formas se siguen aceptando por si la API responde plano.
 */
function idDelMensaje(res: unknown): string | null {
  const r = res as {
    data?: { messageId?: string };
    message?: { id?: string };
    id?: string;
  } | null;
  const id = r?.data?.messageId ?? r?.message?.id ?? r?.id;
  return id ? String(id) : null;
}

/** Ruta de respuesta de una conversación (JSON y multipart comparten endpoint). */
function sendPath(conversationId: string): string {
  return `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`;
}

/**
 * Responde en una conversación de Zernio.
 *
 * `accountId` va en el cuerpo aunque la conversación ya lo implique (lo exige
 * la API). `Idempotency-Key` evita que un reintento mande el mensaje dos
 * veces: la llave natural es el id que Vocero ya generó para ese envío.
 */
export async function sendZernioMessage(input: {
  token: string;
  accountId: string | null;
  conversationId: string | null;
  text: string;
  /** Fuera de la ventana de 24 h, la única etiqueta admitida. */
  humanAgentTag?: boolean;
  idempotencyKey?: string;
}): Promise<ZernioSendResult> {
  if (!input.conversationId) {
    throw new MetaApiError(
      "La conversación no tiene referencia de hilo en Zernio",
      { status: 400 }
    );
  }

  const body: Record<string, unknown> = {
    accountId: input.accountId,
    message: input.text,
  };
  if (input.humanAgentTag) {
    body.messagingType = "MESSAGE_TAG";
    body.messageTag = "HUMAN_AGENT";
  }

  const res = await zernioFetch(sendPath(input.conversationId), {
    method: "POST",
    token: input.token,
    body,
    ...(input.idempotencyKey
      ? { headers: { "Idempotency-Key": input.idempotencyKey } }
      : {}),
  });

  return { platformMessageId: idDelMensaje(res) ?? `zernio_${Date.now()}` };
}

/**
 * 023 — Adjunto saliente por Zernio.
 *
 * No hay subida a la Graph API que preceda al envío: Zernio recibe el binario
 * él mismo (multipart con la parte `attachment`) y se encarga de la plataforma.
 * Por eso el CRM no necesita un token de Meta ni una URL pública propia para
 * mandar una foto — con `attachmentUrl` sí la necesitaría.
 */
export async function sendZernioAttachment(input: {
  token: string;
  accountId: string | null;
  conversationId: string | null;
  kind: "image" | "video" | "audio" | "document";
  data: Buffer;
  fileName: string;
  mimeType: string;
  caption?: string | null;
  idempotencyKey?: string;
}): Promise<ZernioSendResult> {
  if (!input.conversationId) {
    throw new MetaApiError(
      "La conversación no tiene referencia de hilo en Zernio",
      { status: 400 }
    );
  }

  const form = new FormData();
  if (input.accountId) form.append("accountId", input.accountId);
  // WhatsApp no muestra pie en un audio: sería un segundo mensaje.
  if (input.caption && input.kind !== "audio") {
    form.append("message", input.caption);
  }
  form.append(
    "attachment",
    // La copia es intencional: Blob quiere un ArrayBuffer y un Buffer puede
    // estar montado sobre memoria compartida.
    new Blob([Uint8Array.from(input.data)], { type: input.mimeType }),
    input.fileName
  );

  const res = await zernioFetch(sendPath(input.conversationId), {
    method: "POST",
    token: input.token,
    form,
    ...(input.idempotencyKey
      ? { headers: { "Idempotency-Key": input.idempotencyKey } }
      : {}),
  });

  return { platformMessageId: idDelMensaje(res) ?? `zernio_${Date.now()}` };
}

/**
 * Ubicación o tarjeta(s) de contacto por Zernio. Los campos son los mismos que
 * acepta la Cloud API de WhatsApp, así que el llamador arma un payload único
 * para los dos transportes.
 */
export async function sendZernioStructured(input: {
  token: string;
  accountId: string | null;
  conversationId: string | null;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: unknown[];
  idempotencyKey?: string;
}): Promise<ZernioSendResult> {
  if (!input.conversationId) {
    throw new MetaApiError(
      "La conversación no tiene referencia de hilo en Zernio",
      { status: 400 }
    );
  }

  const res = await zernioFetch(sendPath(input.conversationId), {
    method: "POST",
    token: input.token,
    body: {
      accountId: input.accountId,
      ...(input.location ? { location: input.location } : {}),
      ...(input.contacts ? { contacts: input.contacts } : {}),
    },
    ...(input.idempotencyKey
      ? { headers: { "Idempotency-Key": input.idempotencyKey } }
      : {}),
  });

  return { platformMessageId: idDelMensaje(res) ?? `zernio_${Date.now()}` };
}

/**
 * «escribiendo…» en WhatsApp (y azules del último entrante de paso, que es lo
 * que hace Meta con el `typing_indicator`). Zernio refiere al entrante más
 * reciente él mismo: no hay `wamid` que buscar.
 *
 * Es best-effort por contrato: siempre responde 200 y `success` dice si de
 * verdad llegó a la plataforma.
 */
export async function sendZernioTyping(input: {
  token: string;
  accountId: string | null;
  conversationId: string;
}): Promise<boolean> {
  const res = await zernioFetch(
    `/inbox/conversations/${encodeURIComponent(input.conversationId)}/typing`,
    { method: "POST", token: input.token, body: { accountId: input.accountId } }
  );
  return Boolean((res as { success?: boolean } | null)?.success);
}

/** Comprueba que la llave sirve (se usa antes de guardar una conexión). */
export async function verifyZernioToken(token: string): Promise<void> {
  await zernioFetch("/inbox/conversations?limit=1", { token });
}

/** Una cuenta conectada en Zernio, en lo que le sirve al CRM para elegir una. */
export type ZernioAccount = {
  id: string;
  name: string | null;
  /** El número en pantalla, cuando la cuenta es un teléfono. */
  phoneNumber: string | null;
  /** El número compartido de pruebas de Zernio, no un número del cliente. */
  sandbox: boolean;
  isActive: boolean;
  needsReconnection: boolean;
};

/**
 * Cuentas conectadas de una plataforma.
 *
 * Verificado contra el servicio real el 2026-10-26: con `platform=whatsapp` y
 * sin más parámetros Zernio responde `{"accounts":[]}` para un equipo que solo
 * tiene el sandbox — el número de pruebas **no entra en la lista** hasta que se
 * pide `includeSandbox`, y por eso es un argumento explícito y no un default:
 * ofrecerlo por defecto conectaría sin querer un número compartido entre todos
 * los que prueban.
 */
export async function listZernioAccounts(
  token: string,
  platform: string,
  opts: { sandbox?: boolean } = {}
): Promise<ZernioAccount[]> {
  const res = await zernioFetch(
    `/accounts?platform=${encodeURIComponent(platform)}` +
      (opts.sandbox ? "&includeSandbox=true" : ""),
    { token }
  );
  const rows = (res as { accounts?: unknown[] } | null)?.accounts ?? [];
  return rows
    .map((r) => r as Partial<Record<string, unknown>> | null)
    .filter((r) => typeof r?._id === "string" && r._id !== "")
    .map((r) => {
      const meta = (r!.metadata ?? {}) as Partial<Record<string, unknown>>;
      const telefono = (v: unknown) =>
        typeof v === "string" && v ? v : null;
      return {
        id: String(r!._id),
        name:
          (typeof r!.displayName === "string" && r!.displayName) ||
          (typeof r!.username === "string" && r!.username) ||
          (typeof r!.platformUserId === "string" && r!.platformUserId) ||
          null,
        phoneNumber:
          telefono(meta.displayPhoneNumber) ??
          (typeof r!.username === "string" && r!.username.startsWith("+")
            ? r!.username
            : null),
        sandbox: meta.isSandbox === true,
        isActive: r!.isActive !== false,
        needsReconnection: r!.needsReconnection === true,
      };
    });
}

/**
 * Traduce los fallos de Zernio al MetaApiError que el resto del CRM ya sabe
 * interpretar — incluido `isAuthError`, que distingue una llave muerta de un
 * hipo transitorio y costó un incidente aprender.
 */
async function zernioFetch(
  path: string,
  opts: {
    method?: "GET" | "POST";
    token: string;
    body?: unknown;
    /** Cuerpo multipart: la propia fetch le pone el boundary. */
    form?: FormData;
    headers?: Record<string, string>;
  }
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${ZERNIO_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers ?? {}),
      },
      body:
        opts.form !== undefined
          ? opts.form
          : opts.body !== undefined
            ? JSON.stringify(opts.body)
            : undefined,
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Zernio", {
      status: 0,
      details: cause,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo en los detalles
  }

  if (!res.ok) {
    const err = json as { error?: { message?: string } | string } | null;
    const message =
      typeof err?.error === "string"
        ? err.error
        : (err?.error?.message ?? `HTTP ${res.status}`);
    throw new MetaApiError(message, {
      status: res.status,
      details: json ?? text,
    });
  }
  return json;
}
