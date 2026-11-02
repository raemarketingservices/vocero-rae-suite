import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeMx } from "@/lib/meta/client";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import {
  SUPPORTED_TYPES,
  getOrCreateConversation,
  toDate,
} from "@/server/inbox/ingest";
import type {
  WebhookHistoryChunk,
  WebhookHistoryMessage,
  WebhookHistoryThread,
  WebhookStateSyncEntry,
  WebhookValue,
} from "@/server/inbox/webhook";

/**
 * Relleno de coexistence: los dos webhooks que llegan DESPUÉS del alta desde
 * la app de WhatsApp Business del teléfono.
 *
 * - `history`: hasta 180 días de conversaciones previas, en fases (0-1, 1-90,
 *   90-180) y trozos que Meta puede reenviar.
 * - `smb_app_state_sync`: la agenda del teléfono (contactos nuevos o
 *   renombrados).
 *
 * Lo que los dos comparten y lo que los hace delicados: son PASADO, no
 * actividad. Ninguno debe abrir la ventana de 24 h, mover el no-leído, pausar
 * a la IA, disparar al agente ni publicar por SSE —un relleno de seis meses
 * reventaría la bandeja de una tienda y le cerraría el bot de un golpe. Se
 * ingeren mensajes, no signos.
 */

/* ---------- `history` ---------- */

export type MensajeHistorico = {
  waMessageId: string;
  /** Llave del hilo: teléfono normalizado del CLIENTE (no del negocio). */
  identidad: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  timestamp: string;
};

export type RellenoHistorico = {
  phoneNumberId: string | null;
  mensajes: MensajeHistorico[];
  /** Última `progress` vista; solo para el log y el self-test. */
  progreso: string | null;
};

/**
 * Parser tolerante del `value` de un cambio `history`.
 *
 * La forma real NO es la que documenta Meta: los mensajes vienen anidados
 * `history[] → threads[] → messages[]`, y el teléfono del cliente está en el
 * `id` del hilo. Se aceptan igual los hilos sueltos en `value.threads`, porque
 * un webhook que cambia de forma en silencio no debe vaciar la bandeja.
 *
 * Un mensaje sin id, sin hilo al que colgar o de un tipo no soportado se
 * descarta; jamás lanza.
 */
export function parseHistoryValue(value: WebhookValue): RellenoHistorico {
  const conHilos = (value.history ?? []).filter(
    (c): c is WebhookHistoryChunk => typeof c === "object" && c !== null
  );
  const trozos: WebhookHistoryChunk[] =
    conHilos.length > 0 ? conHilos : [{ threads: hilosSueltos(value) }];

  const mensajes: MensajeHistorico[] = [];
  let progreso: string | null = null;

  for (const trozo of trozos) {
    const bruto = trozo.metadata?.progress;
    if (typeof bruto === "string" && bruto.trim()) progreso = bruto.trim();

    const hilos = trozo.threads ?? hilosSueltos(value);
    for (const hilo of hilos) {
      if (typeof hilo !== "object" || hilo === null) continue;
      const identidadDelHilo = limpio(hilo.id) ? normalizeMx(limpio(hilo.id)!) : null;
      for (const msg of Array.isArray(hilo.messages) ? hilo.messages : []) {
        const uno = parseMensajeHistorico(msg, identidadDelHilo);
        if (uno) mensajes.push(uno);
      }
    }
  }

  return {
    phoneNumberId: limpio(value.metadata?.phone_number_id),
    mensajes,
    progreso,
  };
}

function hilosSueltos(value: WebhookValue): WebhookHistoryThread[] {
  const raw = (value as unknown as { threads?: unknown }).threads;
  return Array.isArray(raw) ? (raw as WebhookHistoryThread[]) : [];
}

/** Uno de los mensajes del relleno, o null si no es ingerible. */
function parseMensajeHistorico(
  msg: WebhookHistoryMessage,
  identidadDelHilo: string | null
): MensajeHistorico | null {
  if (typeof msg !== "object" || msg === null) return null;
  const id = limpio(msg.id);
  if (!id || !SUPPORTED_TYPES.has(msg.type)) return null;

  const desde = limpio(msg.from);
  const identidad = identidadDelHilo ?? (desde ? normalizeMx(desde) : null);
  if (!identidad) return null;

  return {
    waMessageId: id,
    identidad,
    direction: direccionDelRelleno(msg, identidad),
    type: msg.type,
    text: limpio(msg.text?.body),
    timestamp: limpio(msg.timestamp) ?? String(Math.floor(Date.now() / 1000)),
  };
}

/**
 * Quién escribió el mensaje viejo.
 *
 * `history_context.from_me` es la señal que manda Meta. Si falta —puede
 * faltar—, el mensaje es del negocio cuando lo envía un número DISTINTO del
 * del hilo, que es el del CLIENTE. Sin ninguna de las dos pistas, entra como
 * entrante: es la lectura que no inventa un saliente que nadie escribió.
 */
function direccionDelRelleno(
  msg: WebhookHistoryMessage,
  identidadDelHilo: string
): "in" | "out" {
  const fromMe = msg.history_context?.from_me;
  if (typeof fromMe === "boolean") return fromMe ? "out" : "in";
  const desde = limpio(msg.from);
  return desde && normalizeMx(desde) !== identidadDelHilo ? "out" : "in";
}

/**
 * Ingiere el relleno de un número. Idempotente por `wa_message_id`: Meta
 * reenvía trozos, y un reintento no debe duplicar mensajes.
 */
export async function processHistoryValue(value: WebhookValue): Promise<void> {
  const relleno = parseHistoryValue(value);
  if (!relleno.phoneNumberId) {
    console.warn("[history] payload sin phone_number_id: descartado");
    return;
  }

  const credentials = await getCredentialsByPhoneNumberId(relleno.phoneNumberId);
  if (!credentials) {
    console.warn(
      `[history] relleno para phone_number_id desconocido (${relleno.phoneNumberId}): descartado`
    );
    return;
  }

  if (relleno.mensajes.length === 0) {
    console.log(
      `[history] sin mensajes ingeribles (progress=${relleno.progreso ?? "?"}): nada que hacer`
    );
    return;
  }

  let nuevos = 0;
  for (const mensaje of relleno.mensajes) {
    try {
      if (await ingestarMensajeHistorico(credentials.organizationId, mensaje)) {
        nuevos++;
      }
    } catch (err) {
      // Un hilo malformado no tumba el resto del relleno (FR-013 del webhook).
      console.error(`[history] error con ${mensaje.waMessageId}:`, err);
    }
  }
  console.log(
    `[history] ${nuevos}/${relleno.mensajes.length} mensajes del relleno registrados (progress=${
      relleno.progreso ?? "?"
    })`
  );
}

/** Devuelve false si el mensaje ya estaba (duplicado). */
async function ingestarMensajeHistorico(
  organizationId: string,
  m: MensajeHistorico
): Promise<boolean> {
  const db = getDb();

  const { contact } = await getOrCreateContactByIdentity(organizationId, {
    identity: m.identidad,
    phone: m.identidad,
    waUserId: null,
    profileName: null,
  });
  const conversation = await getOrCreateConversation(organizationId, contact.id);

  const waTimestamp = toDate(m.timestamp);

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: m.waMessageId,
      direction: m.direction,
      type: m.type,
      text: m.text,
      status: m.direction === "in" ? "delivered" : "sent",
      origin: "history",
      aiGenerated: false,
      waTimestamp,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] })
    .returning();
  if (!inserted[0]) return false;

  /**
   * Solo `lastMessageAt`, y solo hacia adelante.
   *
   * Se excluyen a propósito TODO lo que hace un mensaje vivo: `lastInboundAt`
   * (un entrante de hace tres meses reabriría la ventana de 24 h, y Meta paga
   * el envío fuera de ventana con 131047), `unreadCount`, la pausa de la IA,
   * el turno del agente, el lead del embudo y los eventos de SSE. Y los
   * adjuntos: los `media id` del relleno solo sirven 14 días, así que
   * descargarlos sería sembrar la BD de `pending` condenados a fallar.
   */
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: waTimestamp, updatedAt: new Date() })
    .where(
      and(
        eq(schema.conversation.id, conversation.id),
        sql`(${schema.conversation.lastMessageAt} is null or ${schema.conversation.lastMessageAt} < ${waTimestamp})`
      )
    );

  return true;
}

/* ---------- `smb_app_state_sync` ---------- */

export type ContactoDeAgenda = {
  /** Teléfono normalizado del contacto; sin él no hay a quién apuntar. */
  identidad: string;
  name: string | null;
  /** `delete` y lo que no sea un contacto: `ignorar`. */
  accion: "guardar" | "ignorar";
};

/**
 * Parser tolerante de `value.state_sync[]` y de la variante plana que también
 * se ha visto (campos sueltos, o la lista bajo `contacts[]`).
 *
 * Un contacto sin teléfono se descarta: la agenda del celular trae entries de
 * correo o sin número, y en WhatsApp no identifican a nadie.
 */
export function parseStateSyncValue(value: WebhookValue): {
  phoneNumberId: string | null;
  contactos: ContactoDeAgenda[];
} {
  const sync = Array.isArray(value.state_sync) ? value.state_sync : [];
  // La variante plana solo se mira si no viene la documentada: si no, se
  // contarían dos veces los mismos.
  const entradas: WebhookStateSyncEntry[] =
    sync.length > 0
      ? sync
      : Array.isArray(value.contacts)
        ? (value.contacts as unknown as WebhookStateSyncEntry[])
        : [];

  const contactos: ContactoDeAgenda[] = [];
  for (const entrada of entradas) {
    if (typeof entrada !== "object" || entrada === null) continue;
    const anidado =
      typeof entrada.contact === "object" && entrada.contact !== null
        ? entrada.contact
        : entrada;
    const telefono = limpio(anidado.phone_number) ?? limpio(anidado.wa_id);
    if (!telefono) continue;

    const tipo = limpio(entrada.type)?.toLowerCase();
    const accion = limpio(entrada.action)?.toLowerCase();
    contactos.push({
      identidad: normalizeMx(telefono),
      name: limpio(anidado.full_name),
      // `delete` nunca borra ni archiva (el porqué, abajo), y un `type` distinto
      // de contact tampoco: no sabemos a qué se refiere.
      accion:
        (tipo && tipo !== "contact") || accion === "delete" || accion === "removed"
          ? "ignorar"
          : "guardar",
    });
  }

  return { phoneNumberId: limpio(value.metadata?.phone_number_id), contactos };
}

/**
 * La agenda del teléfono del dueño, reflejada en los contactos del CRM.
 *
 * `delete` se IGNORA a propósito: que el dueño quite un número de sus
 * contactos del celular no puede archivar ni borrar a un cliente del CRM —es
 * destructivo, no tiene vuelta atrás y no fue una decisión del negocio.
 *
 * El nombre solo reemplaza al que puso el perfil (`nameSource === "perfil"`,
 * regla de #51): el operador que renombró a alguien no lo pierde.
 */
export async function processAppStateSyncValue(value: WebhookValue): Promise<void> {
  const sync = parseStateSyncValue(value);
  if (!sync.phoneNumberId) {
    console.warn("[state_sync] payload sin phone_number_id: descartado");
    return;
  }

  const credentials = await getCredentialsByPhoneNumberId(sync.phoneNumberId);
  if (!credentials) {
    console.warn(
      `[state_sync] para phone_number_id desconocido (${sync.phoneNumberId}): descartado`
    );
    return;
  }

  let guardados = 0;
  for (const c of sync.contactos) {
    if (c.accion !== "guardar") continue;
    try {
      await getOrCreateContactByIdentity(credentials.organizationId, {
        identity: c.identidad,
        phone: c.identidad,
        waUserId: null,
        profileName: c.name,
      });
      guardados++;
    } catch (err) {
      console.error(`[state_sync] error con ${c.identidad}:`, err);
    }
  }
  if (sync.contactos.length > 0) {
    console.log(
      `[state_sync] ${guardados}/${sync.contactos.length} contactos de la agenda aplicados`
    );
  }
}

function limpio(valor: string | null | undefined): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}
