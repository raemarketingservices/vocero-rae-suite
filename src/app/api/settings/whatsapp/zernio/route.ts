import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { MetaApiError } from "@/lib/meta/client";
import {
  desconectarCanal,
  getCredentialsByOrg,
  hablaPorZernio,
  saveCredentials,
  tokenLast4,
} from "@/server/whatsapp/credentials";
import { listZernioAccounts } from "@/server/zernio";

export const dynamic = "force-dynamic";

/**
 * 023 — La conexión de WhatsApp cuando el número habla por Zernio.
 *
 * Vive en su propia ruta porque lo que se pega no son credenciales de Meta: una
 * API key de Zernio y el `accountId` de la cuenta conectada. Mezclarlas en el
 * PUT de `/api/settings/whatsapp` habría obligado a validar `wabaId`/
 * `phoneNumberId` opcionales — y un `phoneNumberId` opcional es exactamente el
 * tipo de fila a medias que el resto del CRM no sabe leer.
 */

/** Lo que se enseña de una conexión: jamás la llave completa. */
function pintaConexion(creds: {
  accountRef: string | null;
  displayPhoneNumber: string | null;
  status: "connected" | "reconnect_required";
  token: string;
}) {
  return {
    source: "zernio" as const,
    accountRef: creds.accountRef,
    displayPhoneNumber: creds.displayPhoneNumber,
    status: creds.status,
    tokenLast4: tokenLast4(creds.token),
  };
}

export const GET = withAuth(async (session) => {
  const creds = await getCredentialsByOrg(session.organizationId);
  if (!creds || !hablaPorZernio(creds)) {
    return Response.json({ connection: null });
  }
  return Response.json({ connection: pintaConexion(creds) });
});

const putSchema = z.object({
  token: z.string().trim().min(1),
  /** Si falta y la llave tiene una sola cuenta de WhatsApp, se usa esa. */
  accountRef: z.string().trim().min(1).nullish(),
  webhookSecret: z.string().trim().min(1).nullish(),
});

/**
 * Guarda (o actualiza) la conexión validando contra Zernio ANTES de tocar la
 * base, y con la cuenta ya resuelta: `accountRef` es lo que enruta los eventos
 * del webhook, y una conexión sin él no recibe nada.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(
      403,
      "forbidden",
      "Solo el propietario de la organización puede conectar el número"
    );
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const data = body.data;

  const actual = await getCredentialsByOrg(session.organizationId);
  if (actual && !hablaPorZernio(actual)) {
    return apiError(
      409,
      "canal_meta",
      "Este número está conectado con la Cloud API de Meta; desconéctalo antes de pasarlo a Zernio"
    );
  }

  let cuentas: Awaited<ReturnType<typeof listZernioAccounts>>;
  try {
    cuentas = await listZernioAccounts(data.token, "whatsapp");
  } catch (err) {
    return errorDeZernio(err);
  }

  const elegida = elegirCuenta(cuentas, data.accountRef ?? null);
  if (!elegida.ok) {
    // `varias_cuentas` además entrega la lista: la tarjeta la pinta para que
    // el usuario elija, igual que hace el registro insertado de Meta.
    return Response.json(
      {
        error: { code: elegida.code, message: elegida.message },
        ...(elegida.cuentas ? { cuentas: elegida.cuentas } : {}),
      },
      { status: elegida.status }
    );
  }

  await saveCredentials({
    organizationId: session.organizationId,
    source: "zernio",
    // Sin WABA ni Phone Number ID a propósito: son de Meta, y su ausencia es
    // lo que le dice a cualquier superficie de Meta que aquí no tiene nada
    // que hacer.
    wabaId: null,
    phoneNumberId: null,
    accountRef: elegida.cuenta.id,
    webhookSecret: data.webhookSecret ?? null,
    token: data.token,
    displayPhoneNumber: elegida.cuenta.name,
    verifiedName: null,
  });

  return Response.json({
    ok: true,
    connection: pintaConexion({
      accountRef: elegida.cuenta.id,
      displayPhoneNumber: elegida.cuenta.name,
      status: "connected",
      token: data.token,
    }),
  });
});

/**
 * Sueltas la conexión de Zernio. La suscripción del webhook la deshace Zernio
 * en su panel — aquí no hay token de Meta con el que quitar nada — y la bandeja
 * se queda entera: las conversaciones son de la organización.
 */
export const DELETE = withAuth(async (session) => {
  const creds = await getCredentialsByOrg(session.organizationId);
  if (creds && !hablaPorZernio(creds)) {
    return apiError(
      409,
      "canal_meta",
      "Este número habla por Meta: desconéctalo desde su propia tarjeta"
    );
  }
  await desconectarCanal(session.organizationId);
  return Response.json({ ok: true });
});

type Eleccion =
  | { ok: true; cuenta: { id: string; name: string | null } }
  | { ok: false; status: number; code: string; message: string; cuentas?: unknown };

/**
 * La misma regla que el registro insertado de Meta: con un solo número se usa
 * ese; con varios se devuelve la lista para que elija, en lugar de adivinar a
 * qué tienda pertenece la llave.
 */
function elegirCuenta(
  cuentas: Awaited<ReturnType<typeof listZernioAccounts>>,
  accountRef: string | null
): Eleccion {
  if (accountRef) {
    const found = cuentas.find((c) => c.id === accountRef);
    if (!found) {
      return {
        ok: false,
        status: 422,
        code: "cuenta_no_encontrada",
        message:
          "Esa cuenta de Zernio no está en esta API key, o no es de WhatsApp. Copia el accountId del panel de Zernio.",
      };
    }
    return { ok: true, cuenta: found };
  }

  if (cuentas.length === 0) {
    return {
      ok: false,
      status: 422,
      code: "sin_cuentas",
      message:
        "Esta API key no tiene ninguna cuenta de WhatsApp conectada. Vincula el número en Zernio y vuelve a intentar.",
    };
  }
  if (cuentas.length > 1) {
    return {
      ok: false,
      status: 409,
      code: "varias_cuentas",
      message:
        "La API key tiene varios números de WhatsApp: elige cuál quieres conectar.",
      cuentas: cuentas.map((c) => ({
        id: c.id,
        name: c.name,
        needsReconnection: c.needsReconnection,
      })),
    };
  }
  return { ok: true, cuenta: cuentas[0]! };
}

/** Traduce el fallo de Zernio al código que entiende la tarjeta. */
function errorDeZernio(err: unknown): Response {
  if (err instanceof MetaApiError) {
    if (err.isAuthError || err.status === 402) {
      return apiError(
        422,
        "invalid_token",
        err.status === 402
          ? "Zernio rechaza la cuenta: está pausada o sin método de pago"
          : "La API key de Zernio no es válida"
      );
    }
    if (err.status === 0 || err.status >= 500) {
      return apiError(
        503,
        "zernio_unavailable",
        "Zernio no respondió; intenta de nuevo en un momento"
      );
    }
    return apiError(422, "invalid_token", err.message);
  }
  return apiError(500, "internal", "No se pudo verificar la conexión");
}
