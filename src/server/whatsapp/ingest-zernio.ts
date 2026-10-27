import {
  resolveIdentity,
  type ResolvedIdentity,
} from "@/server/inbox/identity";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { applyStatusUpdate } from "@/server/inbox/status";
import type { WebhookMessage, WebhookStatus } from "@/server/inbox/webhook";
import { getCredentialsByAccountRef, type Credentials } from "@/server/whatsapp/credentials";
import { zernioSentAtSeconds, type ZernioEvent } from "@/server/zernio";

/**
 * 023 — Entrada de WhatsApp cuando el número habla por Zernio.
 *
 * Zernio no reescribe el webhook de Meta: entrega su propio evento plano y con
 * sus propios nombres. Aquí se traduce a la forma que ya entiende el núcleo
 * (`resolveIdentity` + `ingestInboundMessage`), así que contacto, conversación,
 * idempotencia, leads, SSE y agente corren idénticos para los dos proveedores —
 * la diferencia de transporte muere en este archivo.
 *
 * La identidad es la parte delicada. Meta manda teléfono (`from`) o BSUID
 * (`from_user_id`), y Zernio manda `sender.phoneNumber` (E.164 con `+`, anulado
 * durante su despliegue de BSUID) o `sender.id`, que es teléfono SIN `+` si lo
 * hay y BSUID si no. Por eso el prefijo se quita y el `sender.id` solo vale
 * como teléfono si lo es: tratar un BSUID como teléfono partiría al contacto en
 * dos, que es justo el fallo que la reconciliación 003 existe para evitar.
 */

/** Tipo de adjunto de Zernio → tipo de mensaje del CRM. */
const ADJUNTO: Record<string, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  file: "document",
  document: "document",
  sticker: "sticker",
};

/** Los adjuntos cuyo binario se puede bajar (el resto no tiene archivo). */
const BINARIOS = new Set(["image", "video", "audio", "document", "sticker"]);

export type ZernioWhatsappInbound = {
  /** `account.id`: la llave con la que se enruta a la organización. */
  accountRef: string;
  identity: ResolvedIdentity;
  waMessageId: string;
  type: string;
  text: string | null;
  timestamp: string;
  /** null = sin adjunto, o adjunto whose url no llegó. */
  media: {
    kind: "image" | "video" | "audio" | "document" | "sticker";
    /** URL de descarga de Zernio, NO un id de Graph. */
    url: string;
    mimeType: string | null;
    caption: string | null;
  } | null;
  /** Hilo de Zernio: lo que hay que usar para responder. */
  threadRef: string | null;
};

/** El teléfono sin `+`, o null si el campo no es un número. */
function telefono(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim().replace(/^\+/, "");
  return /^\d{6,15}$/.test(limpio) ? limpio : null;
}

/**
 * Normaliza un evento `message.received` de WhatsApp. Devuelve null para todo
 * lo que no debe entrar a la bandeja: otra plataforma, otra clase de evento,
 * lo saliente (Vocero ya registra lo que él envía) y los mensajes sin
 * identidad utilizable.
 */
export function normalizeZernioWhatsappEvent(
  payload: unknown
): ZernioWhatsappInbound | null {
  const evt = payload as ZernioEvent | null;
  if (!evt || typeof evt !== "object") return null;
  if ((evt.account?.platform ?? "").toLowerCase() !== "whatsapp") return null;
  if (evt.event !== "message.received") return null;
  // Los salientes llevan id de Zernio, no el `wamid` que el CRM guardó al
  // enviar: ingerirlos duplicaría cada respuesta del agente. Las notas que el
  // dueño escribe desde el teléfono se pierden con esto — era un beneficio de
  // `smb_message_echoes` de la API directa, y Zernio no lo expone.
  if (evt.message?.direction !== "incoming") return null;

  const accountRef = evt.account?.id;
  const messageId = evt.message?.id;
  if (!accountRef || !messageId) return null;

  const phone = telefono(evt.message?.sender?.phoneNumber) ??
    telefono(evt.message?.sender?.id);
  const bsuid = evt.message?.sender?.businessScopedUserId?.trim() || null;
  const nombre =
    evt.message?.sender?.name?.trim() ||
    (evt.message?.sender?.username ? `@${evt.message.sender.username}` : null);

  // Se pasa por resolveIdentity en vez de reimplementar la regla: es la misma
  // función que usa el webhook de Meta, y si se separan, un número migrado a
  // Zernio duplica contactos que ya existían.
  const simulado = {
    id: messageId,
    type: "text",
    from: phone ?? undefined,
    from_user_id: bsuid ?? undefined,
    // `from` ya viene sin `+`; normalizeMx solo reescribe el tronco mexicano.
    timestamp: zernioSentAtSeconds(evt.message?.sentAt),
  } satisfies WebhookMessage;
  const resolved = resolveIdentity(simulado, undefined);
  if (!resolved) {
    console.warn(
      `[whatsapp-zernio] mensaje ${messageId} sin teléfono ni BSUID: descartado`
    );
    return null;
  }
  const identity: ResolvedIdentity = {
    ...resolved,
    profileName: resolved.profileName ?? nombre,
  };

  const texto =
    typeof evt.message?.text === "string" && evt.message.text.length > 0
      ? evt.message.text
      : null;

  const adjunto = evt.message?.attachments?.[0];
  const tipoAdjunto = adjunto?.type ? ADJUNTO[adjunto.type] ?? null : null;
  const url = typeof adjunto?.url === "string" && adjunto.url ? adjunto.url : null;

  let type = "text";
  let media: ZernioWhatsappInbound["media"] = null;
  if (tipoAdjunto && BINARIOS.has(tipoAdjunto)) {
    type = tipoAdjunto;
    // Sin url no hay binario que bajar: el mensaje entra con su tipo para que
    // el operador sepa que hay un adjunto, nunca se descarta en silencio.
    if (url) {
      media = {
        kind: tipoAdjunto as "image" | "video" | "audio" | "document" | "sticker",
        url,
        mimeType: adjunto?.mimeType ?? null,
        caption: texto,
      };
    }
  } else if (adjunto) {
    // `share`, o un tipo que Zernio no clasificó a tiempo: se conserva el
    // mensaje marcado como no soportado, como ya hace Messenger.
    type = "unsupported";
  } else if (!texto) {
    return null; // ni texto ni adjunto: no hay nada que mostrar
  }

  return {
    accountRef,
    identity,
    // Prefijado para que jamás colisione con un `wamid` en el índice único.
    waMessageId: `zw_${messageId}`,
    type,
    text: texto,
    timestamp: zernioSentAtSeconds(evt.message?.sentAt),
    media,
    threadRef: evt.message?.conversationId ?? null,
  };
}

/** Eventos de acuse de Zernio → estado del mensaje del CRM. */
const ACUSE: Record<string, string> = {
  "message.delivered": "delivered",
  "message.read": "read",
  "message.failed": "failed",
};

/**
 * Acuse sobre un mensaje saliente, en la forma que `applyStatusUpdate` ya sabe
 * aplicar. El id que coincide con la burbuja es `platformMessageId` — en
 * WhatsApp el `wamid` crudo que Zernio devolvió al enviar, no su id de evento.
 */
export function normalizeZernioWhatsappAcuse(
  payload: unknown
): { accountRef: string; status: WebhookStatus } | null {
  const evt = payload as ZernioEvent | null;
  if (!evt || typeof evt !== "object") return null;
  if ((evt.account?.platform ?? "").toLowerCase() !== "whatsapp") return null;

  const status = ACUSE[evt.event ?? ""];
  const accountRef = evt.account?.id;
  const wamid = evt.message?.platformMessageId;
  if (!status || !accountRef || !wamid) return null;

  return {
    accountRef,
    status: {
      id: wamid,
      status,
      timestamp: zernioSentAtSeconds(evt.statusAt),
      ...(evt.error
        ? {
            errors: [
              {
                code: Number(evt.error.code ?? 0),
                title: evt.error.title,
                message: evt.error.message,
              },
            ],
          }
        : {}),
    },
  };
}

/**
 * Conexión de la organización dueña de esa cuenta de Zernio, o null con el
 * aviso correspondiente.
 */
async function credencialesDeZernio(
  accountRef: string
): Promise<Credentials | null> {
  const creds = await getCredentialsByAccountRef(accountRef);
  if (!creds) {
    console.warn(
      `[whatsapp-zernio] evento para una cuenta desconocida (${accountRef}): ` +
        "guarda la conexión en Configuración → WhatsApp para recibir mensajes"
    );
    return null;
  }
  if (creds.source !== "zernio") {
    // Defensa en profundidad: este número está conectado por Meta, así que un
    // payload con forma de Zernio no puede ser legítimo aunque llegó por la URL
    // correcta.
    console.warn(
      `[whatsapp-zernio] payload de zernio en una conexión '${creds.source}': descartado`
    );
    return null;
  }
  return creds;
}

/**
 * El `{mediaId}` del endpoint de Zernio (`…/v1/whatsapp/media/{id}`), o null si
 * la URL no lo lleva. Se guarda el id y no la URL porque `waMediaId` viaja al
 * bot como segmento de ruta (`GET /api/bot/media/{mediaId}`), y una URL no es
 * un segmento seguro.
 */
function idDeAdjuntoZernio(url: string): string | null {
  try {
    const ultimo = new URL(url).pathname.split("/").filter(Boolean).pop();
    return ultimo && /^[\w.-]{1,64}$/.test(ultimo) ? ultimo : null;
  } catch {
    return null;
  }
}

export async function processZernioWhatsappEvent(
  payload: unknown
): Promise<void> {
  const acuse = normalizeZernioWhatsappAcuse(payload);
  if (acuse) {
    const creds = await credencialesDeZernio(acuse.accountRef);
    if (creds) await applyStatusUpdate(creds.organizationId, acuse.status);
    return;
  }

  const evt = normalizeZernioWhatsappEvent(payload);
  if (!evt) return;

  const creds = await credencialesDeZernio(evt.accountRef);
  if (!creds) return;

  await ingestInboundMessage({
    organizationId: creds.organizationId,
    identity: evt.identity,
    waMessageId: evt.waMessageId,
    type: evt.type,
    text: evt.text,
    timestamp: evt.timestamp,
    threadRef: evt.threadRef,
    // El adjunto se guarda con su id de media de Zernio: la descarga elige el
    // transporte por cómo está conectada la cuenta (ver `ensureAssetAvailable`).
    media: evt.media
      ? {
          kind: evt.media.kind,
          waMediaId: idDeAdjuntoZernio(evt.media.url) ?? evt.media.url,
          mimeType: evt.media.mimeType,
          fileName: null,
          caption: evt.media.caption,
          payload: null,
          fetchStatus: "pending",
        }
      : null,
  });
}
