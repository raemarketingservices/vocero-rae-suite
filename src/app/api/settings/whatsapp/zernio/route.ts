import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { errorDeZernio } from "@/server/zernio/connect";
import {
  desconectarCanal,
  getCredentialsByAccountRef,
  getCredentialsByOrg,
  hablaPorZernio,
  saveCredentials,
  tokenLast4,
} from "@/server/whatsapp/credentials";
import { listZernioAccounts, type ZernioAccount } from "@/server/zernio";

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
  return Response.json({
    connection: creds && hablaPorZernio(creds) ? pintaConexion(creds) : null,
    // 025: si la instancia ofrece el escaneo de QR con la llave de RAE. Lo
    // decide el entorno, no la tienda, y la tarjeta lo pregunta porque es lo
    // único que le permite mostrar o no ese modo — no puede adivinarlo.
    modoRae: Boolean(getEnv().ZERNIO_MASTER_API_KEY?.trim()),
  });
});

const putSchema = z.object({
  token: z.string().trim().min(1),
  /** Si falta y la llave tiene una sola cuenta de WhatsApp, se usa esa. */
  accountRef: z.string().trim().min(1).nullish(),
  webhookSecret: z.string().trim().min(1).nullish(),
  /**
   * Añade el número de pruebas compartido de Zernio a la lista. Pedir la
   * conexión real nunca lo trae: conectarse al sandbox por accidente mandaría
   * los mensajes de una tienda al número de otro.
   */
  sandbox: z.boolean().optional(),
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

  let cuentas: ZernioAccount[];
  try {
    cuentas = await listZernioAccounts(data.token, "whatsapp", {
      sandbox: data.sandbox === true,
    });
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

  /**
   * 024 — Un número, una tienda.
   *
   * Varias organizaciones pueden pegar la MISMA API key de Zernio (la de RAE,
   * si un cliente no trae la suya) y esa key lista todos los números. Sin esta
   * guarda, conectar el número de la tienda A desde la tienda B no da error:
   * simplemente gana la fila que `getCredentialsByAccountRef` encuentre primera
   * — que sin `ORDER BY` es la que Postgres tenga a bien devolver — y desde ese
   * momento una de las dos bandejas deja de recibir mensajes. Es el fallo más
   * difícil de ver del CRM, porque todo lo demás sigue funcionando.
   *
   * El índice único de `0018_cuenta_zernio_unica` es el seguro; esto es el
   * cartel, para que el propietario entienda qué tiene que desconectar.
   */
  const dueña = await getCredentialsByAccountRef(elegida.cuenta.id);
  if (dueña && dueña.organizationId !== session.organizationId) {
    return apiError(
      409,
      "cuenta_ya_conectada",
      "Ese número de Zernio ya está conectado a otra tienda. Desconéctalo allí antes de traerlo aquí."
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
    displayPhoneNumber: elegida.cuenta.phoneNumber ?? elegida.cuenta.name,
    verifiedName: elegida.cuenta.sandbox ? "Sandbox de Zernio" : null,
  });

  return Response.json({
    ok: true,
    connection: pintaConexion({
      accountRef: elegida.cuenta.id,
      displayPhoneNumber:
        elegida.cuenta.phoneNumber ?? elegida.cuenta.name,
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
  | { ok: true; cuenta: ZernioAccount }
  | { ok: false; status: number; code: string; message: string; cuentas?: unknown };

/**
 * La misma regla que el registro insertado de Meta: con un solo número se usa
 * ese; con varios se devuelve la lista para que elija, en lugar de adivinar a
 * qué tienda pertenece la llave.
 */
function elegirCuenta(
  cuentas: ZernioAccount[],
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
        "Esta API key no tiene ninguna cuenta de WhatsApp conectada. Vincula el número en Zernio y vuelve a intentar; si solo quieres probar, activa el número de pruebas.",
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
        phoneNumber: c.phoneNumber,
        sandbox: c.sandbox,
        needsReconnection: c.needsReconnection,
      })),
    };
  }
  return { ok: true, cuenta: cuentas[0]! };
}

