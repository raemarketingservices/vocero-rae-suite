import { z } from "zod";
import { getEnv } from "@/lib/env";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  registerWebhookForNumber,
  testConnection,
  type WebhookRegistration,
} from "@/server/whatsapp/connect";
import { saveCredentials } from "@/server/whatsapp/credentials";
import { webhookUrl, webhookVerifyToken } from "@/server/whatsapp/webhook-url";

/**
 * Registro insertado de Meta (Embedded Signup) — el modo en que un negocio se
 * conecta SOLO: autoriza desde su Facebook, Meta crea/elige su WABA y su
 * número, y este backend recibe un token del usuario del sistema de ESA
 * cuenta. Los mensajes se cobran en el método de pago del negocio, nunca aquí.
 *
 * Apagado por defecto: sin `META_APP_ID`, `META_APP_SECRET` y
 * `META_EMBEDDED_SIGNUP_CONFIG_ID` la superficie no existe (404) y el botón no
 * se muestra. El secreto de la app jamás se entrega al navegador.
 */

export type Numero = {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
};

export type ResultadoRegistro =
  | {
      ok: true;
      wabaId: string;
      phoneNumberId: string;
      displayPhoneNumber: string | null;
      verifiedName: string | null;
      webhook: WebhookRegistration;
    }
  | { ok: false; code: string; message: string; numeros?: Numero[] };

/** Las tres piezas tienen que estar; con una falta, no hay registro insertado. */
export function embeddedSignupEnabled(): boolean {
  const env = getEnv();
  return Boolean(
    env.META_APP_ID?.trim() &&
      env.META_APP_SECRET?.trim() &&
      env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim()
  );
}

/** Lo que el navegador necesita para montar el SDK. Sin secretos. */
export function embeddedSignupConfig(): {
  enabled: boolean;
  appId: string | null;
  configId: string | null;
  graphVersion: string;
} {
  const env = getEnv();
  return {
    enabled: embeddedSignupEnabled(),
    appId: env.META_APP_ID?.trim() || null,
    configId: env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim() || null,
    graphVersion: env.META_GRAPH_API_VERSION,
  };
}

/**
 * Meta contesta el token suelto o dentro de un objeto según la versión de la
 * Graph; el doc ejemplo muestra ambos. Se aceptan las dos formas.
 */
const intercambioSchema = z.union([
  z.object({
    access_token: z.string().min(1),
    business_id: z.union([z.string(), z.number()]).optional(),
    whatsapp_business_account_id: z.union([z.string(), z.number()]).optional(),
  }),
  z.string().min(1),
]);

function asId(v: string | number | undefined): string | null {
  if (v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Paso 1 del flujo: `GET /oauth/access_token` con el código de un solo uso que
 * devolvió la ventana de Meta. Devuelve el token de la empresa del cliente.
 */
export async function intercambiarCodigo(code: string): Promise<
  | { ok: true; token: string; wabaId: string | null; businessId: string | null }
  | { ok: false; code: string; message: string }
> {
  const env = getEnv();
  const appId = env.META_APP_ID?.trim();
  const appSecret = env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    return {
      ok: false,
      code: "sin_configuracion",
      message:
        "Falta META_APP_ID o META_APP_SECRET en el servidor: sin ellas no se puede intercambiar el código.",
    };
  }

  const query = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
  });

  let json: unknown;
  try {
    json = await graphRequest<unknown>(`oauth/access_token?${query.toString()}`, {
      token: "",
      anonymous: true,
    });
  } catch (err) {
    return errorDeIntercambio(err);
  }

  const parsed = intercambioSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      code: "respuesta_inesperada",
      message: "Meta no devolvió un token al confirmar el código; vuelve a intentarlo.",
    };
  }
  const body = typeof parsed.data === "string" ? { access_token: parsed.data } : parsed.data;
  const token = body.access_token.trim();
  if (!token) {
    return {
      ok: false,
      code: "respuesta_inesperada",
      message: "Meta devolvió un token vacío; vuelve a iniciar el registro.",
    };
  }
  return {
    ok: true,
    token,
    wabaId: asId(body.whatsapp_business_account_id),
    businessId: asId(body.business_id),
  };
}

function errorDeIntercambio(err: unknown): { ok: false; code: string; message: string } {
  if (!(err instanceof MetaApiError)) throw err;
  if (err.isAuthError) {
    return {
      ok: false,
      code: "code_invalido",
      message:
        "Meta rechazó el código: expira en minutos y sirve una sola vez. Reinicia el registro.",
    };
  }
  if (err.status === 0 || err.status >= 500) {
    return {
      ok: false,
      code: "meta_indisponible",
      message: "Meta no está disponible en este momento; intenta de nuevo.",
    };
  }
  // Sin mensaje de Meta no se puede adivinar la causa; el detalle crudo puede
  // traer el secreto de la app en la URL, así que nunca se reenvía.
  return {
    ok: false,
    code: "meta_error",
    message: err.message || "Meta no completó el intercambio del código.",
  };
}

/** Números de la WABA del cliente, con el token recién obtenido. */
async function numerosDeWaba(wabaId: string, token: string): Promise<Numero[]> {
  const res = await graphRequest<{ data?: unknown }>(
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
    { token }
  );
  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows
    .map((r) => r as Partial<Record<string, unknown>>)
    .filter((r) => typeof r?.id === "string" && r.id !== "")
    .map((r) => ({
      id: String(r.id),
      displayPhoneNumber: typeof r.display_phone_number === "string" ? r.display_phone_number : null,
      verifiedName: typeof r.verified_name === "string" ? r.verified_name : null,
    }));
}

/**
 * Termina el registro: cambia el código por el token, resuelve el número,
 * valida contra Meta, guarda cifrado y registra el webhook de esta instancia.
 *
 * El `phoneNumberId` suele venir de la ventana de Meta; si no viene y la WABA
 * tiene un solo número se usa ese. Con varios se devuelve la lista y el
 * usuario elige: el código ya se gastó, así que elegir vuelve a pasar por la
 * ventana en lugar de guardar un token a medias.
 */
export async function completarRegistroInsertado(input: {
  organizationId: string;
  code: string;
  wabaId?: string;
  phoneNumberId?: string;
}): Promise<ResultadoRegistro> {
  const intercambio = await intercambiarCodigo(input.code);
  if (!intercambio.ok) return intercambio;
  const { token } = intercambio;

  const wabaId = (input.wabaId?.trim() || intercambio.wabaId || "").trim();
  if (!wabaId) {
    return {
      ok: false,
      code: "sin_waba",
      message:
        "Meta no indicó qué cuenta de WhatsApp Business autorizó el cliente. Pega los IDs abajo, en modo directo.",
    };
  }

  const phoneNumberId = (input.phoneNumberId?.trim() || "").trim();
  let elegido = phoneNumberId;
  let displayPhoneNumber: string | null = null;
  let verifiedName: string | null = null;

  if (!elegido) {
    let numeros: Numero[];
    try {
      numeros = await numerosDeWaba(wabaId, token);
    } catch (err) {
      return errorDeIntercambio(err);
    }
    if (numeros.length === 0) {
      return {
        ok: false,
        code: "sin_numeros",
        message:
          "La cuenta autorizada no tiene números de WhatsApp. Crea uno en la ventana de Meta y repite.",
      };
    }
    if (numeros.length > 1) {
      return {
        ok: false,
        code: "varios_numeros",
        message: "Esta cuenta tiene varios números: elige cuál quieres conectar.",
        numeros,
      };
    }
    elegido = numeros[0]!.id;
    displayPhoneNumber = numeros[0]!.displayPhoneNumber;
    verifiedName = numeros[0]!.verifiedName;
  }

  const check = await testConnection(elegido, token);
  if (!check.ok) return { ok: false, code: check.code, message: check.message };
  displayPhoneNumber = check.displayPhoneNumber;
  verifiedName = check.verifiedName;

  await saveCredentials({
    organizationId: input.organizationId,
    wabaId,
    phoneNumberId: elegido,
    token,
    displayPhoneNumber,
    verifiedName,
  });

  const webhook = await registerWebhookForNumber({
    wabaId,
    phoneNumberId: elegido,
    token,
    webhookUrl: webhookUrl("wa"),
    verifyToken: webhookVerifyToken(),
  });

  return {
    ok: true,
    wabaId,
    phoneNumberId: elegido,
    displayPhoneNumber,
    verifiedName,
    webhook,
  };
}
