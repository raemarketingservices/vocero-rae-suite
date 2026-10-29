import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { MetaApiError } from "@/lib/meta/client";
import {
  getInstagramCredentialsByAccountRef,
  getInstagramCredentialsByOrg,
  saveInstagramCredentials,
  tokenLast4,
} from "@/server/instagram/credentials";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { listZernioAccounts, type ZernioAccount } from "@/server/zernio";

export const dynamic = "force-dynamic";

/** 014 — Estado de la conexión de Instagram (el token nunca sale entero). */
export const GET = withAuth(async (session) => {
  if (!isChannelEnabled("instagram")) return channelDisabledResponse();
  const creds = await getInstagramCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      source: creds.source,
      igUserId: creds.igUserId,
      accountRef: creds.accountRef,
      username: creds.username,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
    },
  });
});

const putSchema = z.object({
  source: z.enum(["zernio", "meta"]),
  /** En modo Zernio se deduce de la cuenta conectada; en Meta es obligatorio. */
  igUserId: z.string().trim().min(1).nullish(),
  accountRef: z.string().trim().min(1).nullish(),
  username: z.string().trim().nullish(),
  token: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullish(),
});

/**
 * Guarda la conexión validando ANTES contra la plataforma: un token que no
 * sirve no llega a la base.
 *
 * En modo Zernio la validación es más estricta que antes y le quita un campo
 * al usuario: se lista la cuenta en el servicio real (lo que además prueba la
 * llave) y el IG_ID sale de ahí, porque el `igUserId` escrito a mano era la
 * única forma que tenía esta ruta de quedar guardada apuntando a un perfil que
 * no existe — y entonces el webhook no encuentra a quién entregar el mensaje.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!isChannelEnabled("instagram")) return channelDisabledResponse();
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const data = body.data;

  if (data.source === "zernio") {
    const resuelto = await conectarPorZernio(session, data);
    if (resuelto.response) return resuelto.response;
    await saveInstagramCredentials({
      organizationId: session.organizationId,
      source: "zernio",
      igUserId: resuelto.igUserId,
      // El accountId RESUELTO, no el tecleado: con un solo perfil el usuario no
      // lo escribe, y sin accountRef guardado el webhook no tiene a qué tienda
      // entregar el mensaje.
      accountRef: resuelto.accountRef,
      username: resuelto.username ?? data.username ?? null,
      token: data.token,
      webhookSecret: data.webhookSecret ?? null,
    });
    return Response.json({
      ok: true,
      username: resuelto.username ?? data.username ?? null,
    });
  }

  if (!data.igUserId) {
    return apiError(
      422,
      "invalid_body",
      "En modo Meta hace falta el IG_ID del perfil profesional"
    );
  }

  const check = await verifyMeta(data.igUserId, data.token);
  if (!check.ok) {
    return apiError(check.status, check.code, check.message);
  }

  await saveInstagramCredentials({
    organizationId: session.organizationId,
    source: "meta",
    igUserId: data.igUserId,
    accountRef: null,
    username: check.username ?? data.username ?? null,
    token: data.token,
    webhookSecret: null,
  });

  return Response.json({ ok: true, username: check.username ?? null });
});

/**
 * El alta por Zernio, con los mismos rechazos que la tarjeta de WhatsApp: la
 * cuenta ya es de otra tienda, la llave no tiene perfiles de Instagram, o el
 * accountId no está en esa llave.
 *
 * Con un solo perfil se usa ese sin preguntar; con varios no se adivina ninguno
 * y se devuelve la lista (`varias_cuentas`) para que la tarjeta la pinte. El
 * IG_ID sale de la cuenta listada, nunca de lo que tecleó el usuario.
 */
async function conectarPorZernio(
  session: { organizationId: string },
  data: z.infer<typeof putSchema>
): Promise<
  | {
      response: Response;
      igUserId?: never;
      accountRef?: never;
      username?: never;
    }
  | { response: null; igUserId: string; accountRef: string; username: string | null }
> {
  /**
   * 024 — Un número, una tienda. El mismo seguro que la 0018 puso en WhatsApp:
   * con una API key compartida, dos organizaciones podían reclamar la misma
   * cuenta de Zernio y el inbound quedaba repartido al azar. Se comprueba antes
   * de llamar a la plataforma: si el id ya es de otra tienda no hay nada que
   * verificar.
   */
  if (data.accountRef) {
    const dueña = await getInstagramCredentialsByAccountRef(data.accountRef);
    if (dueña && dueña.organizationId !== session.organizationId) {
      return {
        response: apiError(
          409,
          "cuenta_ya_conectada",
          "Esa cuenta de Zernio ya está conectada a otra tienda. Desconéctala allí antes de traerla aquí."
        ),
      };
    }
  }

  let cuentas: ZernioAccount[];
  try {
    cuentas = await listZernioAccounts(data.token, "instagram");
  } catch (err) {
    return { response: errorDeZernio(err) };
  }

  if (cuentas.length === 0) {
    return {
      response: apiError(
        422,
        "sin_cuentas",
        "Esta API key no tiene ningún Instagram conectado. Vincula el perfil en Zernio y vuelve a intentar."
      ),
    };
  }

  if (!data.accountRef && cuentas.length > 1) {
    return {
      response: Response.json(
        {
          error: {
            code: "varias_cuentas",
            message:
              "La API key tiene varios perfiles de Instagram: elige cuál quieres conectar.",
          },
          cuentas: cuentas.map((c) => ({
            id: c.id,
            name: c.name,
            platformUserId: c.platformUserId,
          })),
        },
        { status: 409 }
      ),
    };
  }

  const cuenta = data.accountRef
    ? cuentas.find((c) => c.id === data.accountRef)
    : cuentas[0];
  if (!cuenta) {
    return {
      response: apiError(
        422,
        "cuenta_no_encontrada",
        "Ese accountId no es de Instagram en esta API key. Copia el id del perfil conectado en Zernio."
      )
    };
  }

  const igUserId = cuenta.platformUserId ?? cuenta.name;
  if (!igUserId) {
    return {
      response: apiError(
        422,
        "ig_user_id_falta",
        "Zernio no devolvió el IG_ID de esa cuenta; vuelve a conectar el perfil y reintenta."
      )
    };
  }

  return { response: null, igUserId, accountRef: cuenta.id, username: cuenta.name };
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

type Check =
  | { ok: true; username: string | null }
  | { ok: false; status: number; code: string; message: string };

/**
 * Meta directo: el token tiene que ser DEL IG_ID que se declara. Guardar un
 * token de otro perfil dejaría una conexión que recibe webhooks de uno y
 * contesta por otro.
 */
async function verifyMeta(igUserId: string, token: string): Promise<Check> {
  const url = `${process.env.IG_GRAPH_BASE_URL ?? "https://graph.instagram.com"}/${
    process.env.META_GRAPH_API_VERSION ?? "v25.0"
  }/me?fields=id,username`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return {
      ok: false,
      status: 503,
      code: "platform_unavailable",
      message: "No se pudo contactar la plataforma; intenta de nuevo",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: 422,
      code: "invalid_token",
      message: "El token de Instagram no es válido o no tiene permiso de mensajes",
    };
  }

  const json = (await res.json().catch(() => null)) as {
    id?: string;
    username?: string;
  } | null;
  if (json?.id && json.id !== igUserId) {
    return {
      ok: false,
      status: 422,
      code: "id_mismatch",
      message: `El IG_ID del token es ${json.id}, no ${igUserId}`,
    };
  }
  return { ok: true, username: json?.username ?? null };
}
