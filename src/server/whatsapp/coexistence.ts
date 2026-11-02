import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  getCredentialsByPhoneNumberId,
  getCredentialsByWabaId,
  markConnected,
  markReconnectRequired,
} from "@/server/whatsapp/credentials";
import type { WebhookValue } from "@/server/inbox/webhook";

/**
 * Coexistence (la app de WhatsApp Business del teléfono conviviendo con la
 * Cloud API).
 *
 * Lo que Meta exige y lo que este módulo hace al respecto:
 *
 * 1. Los CAMPOS del webhook (`history`, `smb_app_state_sync`,
 *    `smb_message_echoes`, `account_update`) se suscriben UNA SOLA VEZ en el
 *    panel de la app. La API de suscripciones no admite campos para WhatsApp
 *    —`POST /{WABA}/subscribed_apps` no lleva `subscribed_fields`—, así que no
 *    hay nada que escribir aquí: lo que sí se puede es LEER lo que quedó
 *    suscrito y avisar si falta algo. Un CRM que no puede comprobar sus propios
 *    webhooks es un CRM que debuguea a ciegas.
 * 2. Pedir el relleno (`POST /{PHONE_NUMBER_ID}/smb_app_data`) sí es de la
 *    API, y es de un solo uso: una vez por conexión y dentro de las 24 h
 *    siguientes al alta.
 * 3. `account_update` avisa cuando el dueño corta la conexión desde su
 *    teléfono; aquí se traduce en el estado de la credencial.
 */

/** Los campos que la coexistence necesita para no dejar huecos en la bandeja. */
export const COEXISTENCE_FIELDS = [
  "messages",
  "smb_message_echoes",
  "history",
  "smb_app_state_sync",
  "account_update",
] as const;

export type EstadoDeCampos = {
  /**
   * Los campos que Meta reporta suscritos. `null` = no los reporta (el token
   * no tiene el permiso, la app no lo devuelve o la respuesta vino vacía):
   * entonces NO se alarma — no podemos afirmar que falte nada.
   */
  suscriptos: string[] | null;
  /** Vacío cuando no hay reporte o cuando están todos. */
  faltan: string[];
};

/**
 * Lee `subscribed_apps` y extrae los campos suscritos.
 *
 * Tolerante porque Meta lo reporta en dos sitios según la versión del endpoint
 * y de qué se pidió: a nivel de la entrada y dentro de
 * `whatsapp_business_api_data`. Se unen los dos.
 */
export function parseSubscribedFields(res: unknown): string[] | null {
  const data = (res as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length === 0) return null;

  const todos = new Set<string>();
  for (const app of data) {
    if (typeof app !== "object" || app === null) continue;
    const afuera = (app as { subscribed_fields?: unknown }).subscribed_fields;
    const adentro = (app as { whatsapp_business_api_data?: { subscribed_fields?: unknown } })
      .whatsapp_business_api_data?.subscribed_fields;
    for (const lista of [afuera, adentro]) {
      if (!Array.isArray(lista)) continue;
      for (const campo of lista) {
        if (typeof campo === "string" && campo.trim()) todos.add(campo.trim());
      }
    }
  }
  return todos.size > 0 ? [...todos] : null;
}

export function camposFaltantes(suscriptos: string[] | null): string[] {
  if (!suscriptos) return [];
  return COEXISTENCE_FIELDS.filter((f) => !suscriptos.includes(f));
}

/** `GET /{WABA}/subscribed_apps` → qué campos están suscritos (best-effort). */
export async function leerCamposSuscritos(
  wabaId: string,
  token: string
): Promise<EstadoDeCampos> {
  try {
    const res = await graphRequest<unknown>(`${wabaId}/subscribed_apps`, { token });
    const suscriptos = parseSubscribedFields(res);
    return { suscriptos, faltan: camposFaltantes(suscriptos) };
  } catch (err) {
    console.warn(
      "[coexistence] no se pudieron leer los campos suscritos:",
      err instanceof MetaApiError ? `${err.status} ${err.code ?? ""}` : "sin respuesta"
    );
    return { suscriptos: null, faltan: [] };
  }
}

export type EstadoDelNumero = {
  /**
   * `true` = el número está montado en la app de WhatsApp Business (hay
   * coexistence que sincronizar). `null` = Meta no lo reporta: el token no
   * tiene el permiso, el campo no existe en esa versión, o la cuenta no es de
   * una PyME que tenga app del teléfono.
   */
  enAppDeNegocio: boolean | null;
  /** `CLOUD_API`, `BIZ_APP`… Se guarda para el diagnóstico, no se decide con él. */
  platformType: string | null;
};

function toBoolean(valor: unknown): boolean | null {
  if (typeof valor === "boolean") return valor;
  if (valor === "true") return true;
  if (valor === "false") return false;
  return null;
}

export function parseNumeroBizApp(res: unknown): EstadoDelNumero {
  const origen = (res ?? {}) as {
    is_on_biz_app?: unknown;
    platform_type?: unknown;
  };
  return {
    enAppDeNegocio: toBoolean(origen.is_on_biz_app),
    platformType:
      typeof origen.platform_type === "string" && origen.platform_type.trim()
        ? origen.platform_type.trim()
        : null,
  };
}

/** `GET /{PHONE_NUMBER_ID}?fields=is_on_biz_app,platform_type` (best-effort). */
export async function leerEstadoDelNumero(
  phoneNumberId: string,
  token: string
): Promise<EstadoDelNumero> {
  try {
    const res = await graphRequest<unknown>(
      `${phoneNumberId}?fields=is_on_biz_app,platform_type`,
      { token }
    );
    return parseNumeroBizApp(res);
  } catch (err) {
    console.warn(
      "[coexistence] no se pudo leer is_on_biz_app del número:",
      err instanceof MetaApiError ? `${err.status} ${err.code ?? ""}` : "sin respuesta"
    );
    return { enAppDeNegocio: null, platformType: null };
  }
}

/** El diagnóstico que acompaña al registro del webhook. */
export type CoexistenceCheck = EstadoDelNumero & { campos: EstadoDeCampos };

/**
 * ¿Este número tiene coexistence y están suscritos sus campos?
 *
 * Se corta en el primer `false` confirmado: un número que NO está en la app
 * del teléfono no tiene nada que sincronizar y no necesita history ni
 * state_sync. Con `enAppDeNegocio: null` (no verificable) sí se leen los
 * campos: es más caro callarse que hacer un GET.
 */
export async function revisarCoexistence(opts: {
  wabaId: string;
  phoneNumberId: string;
  token: string;
}): Promise<CoexistenceCheck> {
  const estado = await leerEstadoDelNumero(opts.phoneNumberId, opts.token);
  if (estado.enAppDeNegocio === false) {
    return { ...estado, campos: { suscriptos: null, faltan: [] } };
  }
  return { ...estado, campos: await leerCamposSuscritos(opts.wabaId, opts.token) };
}

/* ---------- Sincronización inicial (`smb_app_data`) ---------- */

export type SyncType = "history" | "smb_app_state_sync";

export type SolicitudSync =
  | { ok: true; syncType: SyncType }
  | {
      ok: false;
      syncType: SyncType;
      code:
        | "sin_coexistence"
        | "ya_solicitada"
        | "fuera_de_ventana"
        | "sin_permiso"
        | "meta_no_responde"
        | "error";
      message: string;
    };

/**
 * Pide a Meta el relleno de una conexión recién creada.
 *
 * Un solo uso por conexión y dentro de las 24 h del alta: por eso se llama
 * desde el guardado, no en cada arranque. Reintentarlo no rompe nada —Meta
 * responde un código de duplicado que aquí se traduce a «ya se pidió»—, pero
 * tampoco sirve de nada insistir pasado el plazo.
 */
export async function solicitarSincronizacion(opts: {
  phoneNumberId: string;
  token: string;
  syncType: SyncType;
}): Promise<SolicitudSync> {
  const { phoneNumberId, token, syncType } = opts;
  try {
    await graphRequest(`${phoneNumberId}/smb_app_data`, {
      method: "POST",
      token,
      body: { messaging_product: "whatsapp", sync_type: syncType },
    });
    return { ok: true, syncType };
  } catch (err) {
    if (!(err instanceof MetaApiError)) throw err;
    const subcode = (err.details as { error?: { error_subcode?: number } })?.error
      ?.error_subcode;
    if (subcode === 2593107) {
      return {
        ok: false,
        syncType,
        code: "ya_solicitada",
        message: "El relleno ya se había pedido para esta conexión.",
      };
    }
    if (subcode === 2593108) {
      return {
        ok: false,
        syncType,
        code: "fuera_de_ventana",
        message:
          "Meta ya no acepta el relleno: la sincronización se pide una sola vez y dentro de las 24 horas del alta.",
      };
    }
    /**
     * El caso del alta self-serve: un número registrado a mano en la Cloud API
     * nunca entró a coexistence, y Meta lo dice con 131000 (subcode 10) o con
     * 133010. No es un problema del token —decir «sin permiso» mandaría al
     * dueño a revisar el sitio equivocado—, es que no hay app de teléfono de
     * la que rellenar: el número funciona igual y los mensajes nuevos llegan.
     */
    if (err.code === 131000 || err.code === 133010 || subcode === 10) {
      return {
        ok: false,
        syncType,
        code: "sin_coexistence",
        message:
          "Meta no tiene de qué rellenar: este número entró a la Cloud API a secas, no en coexistence desde la app de WhatsApp Business del teléfono. Los mensajes nuevos funcionan igual.",
      };
    }
    if (err.isAuthError) {
      return {
        ok: false,
        syncType,
        code: "sin_permiso",
        message: "El token no permite sincronizar la app del teléfono.",
      };
    }
    if (err.code === 200 || err.code === 10 || err.status === 403) {
      return {
        ok: false,
        syncType,
        code: "sin_permiso",
        message:
          "El token no tiene whatsapp_business_management sobre este número: no se pidió el relleno.",
      };
    }
    if (err.status === 0 || err.status >= 500) {
      return {
        ok: false,
        syncType,
        code: "meta_no_responde",
        message: "Meta no está disponible; el relleno no se pidió.",
      };
    }
    return { ok: false, syncType, code: "error", message: err.message };
  }
}

/**
 * Pide los dos rellenos de una conexión nueva. Best-effort por contrato:
 * guardar la conexión NUNCA puede fallar por esto.
 */
export async function solicitarSincronizacionesIniciales(opts: {
  phoneNumberId: string;
  token: string;
}): Promise<SolicitudSync[]> {
  const tipos: SyncType[] = ["history", "smb_app_state_sync"];
  const resultados: SolicitudSync[] = [];
  for (const syncType of tipos) {
    try {
      resultados.push(await solicitarSincronizacion({ ...opts, syncType }));
    } catch (err) {
      console.error(`[coexistence] fallo raro pidiendo ${syncType}:`, err);
    }
  }
  for (const r of resultados) {
    if (!r.ok) console.warn(`[coexistence] ${r.syncType}: ${r.message}`);
  }
  return resultados;
}

/* ---------- `account_update` ---------- */

export type EventoDeCuenta =
  | "desconectada"
  | "reconectada"
  | "partner_removido"
  | null;

/**
 * El evento de `account_update`, en las tres formas que se han visto: las
 * constantes documentadas, las que Meta manda sin prefijo y la variante en
 * minúsculas de algunos envíos. `null` = no es de los que cambian algo.
 */
export function parseAccountUpdateEvent(value: WebhookValue): EventoDeCuenta {
  const crudo = typeof value.event === "string" ? value.event.trim().toUpperCase() : "";
  const evento = crudo.replace(/^ACCOUNT_/, "");
  if (evento === "OFFBOARDED") return "desconectada";
  if (evento === "RECONNECTED") return "reconectada";
  if (evento === "PARTNER_REMOVED") return "partner_removido";
  return null;
}

/**
 * El dueño desconectó (o reconectó) la cuenta desde su teléfono, o alguien le
 * quitó el acceso a la app.
 *
 * Llega a nivel WABA, sin `phone_number_id` casi nunca: se enruta por el
 * número si el payload lo trae y si no, por `entry.id`. La desconexión se
 * traduce en `reconnect_required`, que es lo que ya hace el CRM: pausa los
 * envíos y le muestra al dueño el botón de reconectar. Reconectar limpia el
 * estado sin tocar nada más — las conversaciones siguen siendo de la tienda.
 */
export async function processAccountUpdateValue(
  wabaId: string | null,
  value: WebhookValue
): Promise<void> {
  const evento = parseAccountUpdateEvent(value);
  if (!evento) return;

  const phoneNumberId =
    typeof value.metadata?.phone_number_id === "string"
      ? value.metadata.phone_number_id
      : null;
  const credentials = phoneNumberId
    ? await getCredentialsByPhoneNumberId(phoneNumberId)
    : wabaId
      ? await getCredentialsByWabaId(wabaId)
      : null;
  if (!credentials) {
    console.warn(
      `[account_update] ${value.event} para una cuenta desconocida (${
        phoneNumberId ?? wabaId ?? "sin ids"
      }): descartado`
    );
    return;
  }

  const motivo = [
    typeof value.disconnection_info?.reason === "string"
      ? value.disconnection_info.reason.trim()
      : "",
    typeof value.disconnection_info?.initiated_by === "string"
      ? `por ${value.disconnection_info.initiated_by}`
      : "",
    value.reason?.trim() ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if (evento === "reconectada") {
    await markConnected(credentials.organizationId);
    console.log(
      `[account_update] el dueño reconectó ${
        credentials.phoneNumberId ?? credentials.wabaId ?? "?"
      }: envíos reactivados`
    );
    return;
  }

  await markReconnectRequired(credentials.organizationId);
  console.warn(
    `[account_update] cuenta ${credentials.wabaId ?? "?"} ${
      evento === "partner_removido" ? "perdió el acceso de la app" : "desconectada desde el teléfono"
    }${motivo ? ` (${motivo})` : ""}: envíos pausados`
  );
}
