import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  conectarCuenta,
  errorDeZernio,
  estadoHandoff,
  iniciarConexion,
  perfilDeOrg,
  type CuentaConectada,
  type ResultadoConexion,
} from "@/server/zernio/connect";
import { getCredentialsByOrg, hablaPorZernio, tokenLast4 } from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

/**
 * 025 — El escaneo de QR, del lado del servidor.
 *
 * Esta ruta existe para que el dueño de una tienda NO tenga que abrir Zernio.
 * Con `ZERNIO_MASTER_API_KEY` el CRM resuelve el perfil de la tienda, pide el
 * link de escaneo y sostiene el resultado; quien conecta escanea con su
 * teléfono y ya. Sin esa variable la superficie responde 404: para una
 * instancia que no ofrece el modo RAE, estos endpoints no existen (misma regla
 * que `AGENDA`, `CHANNELS` y el panel de plataforma).
 *
 * La llave maestra nunca sale de aquí. No hay un PUT que la acepte del
 * navegador — el agujero que eso dejaba (pegar la llave de RAE en otra tienda y
 * elegir el número de un tercero) es la razón de que el modo QR se resuelva por
 * completo en el servidor.
 *
 * Los estados que se responden son los de Zernio (`waiting`, `opened`,
 * `connected`, `failed`, `expired`) y son a la vez el valor de la columna: un
 * segundo vocabulario para la misma cosa es una segunda forma de equivocarse.
 * Lo único traducido es el texto que lee una persona.
 */

function llaveMaestra(): string | null {
  const k = getEnv().ZERNIO_MASTER_API_KEY?.trim();
  return k ? k : null;
}

/** Cuánto le queda al enlace, según el reloj de aquí (el del navegador no cuenta). */
function segundosRestantes(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const fin = Date.parse(expiresAt);
  if (Number.isNaN(fin)) return null;
  return Math.max(0, Math.round((fin - Date.now()) / 1000));
}

/** Un escaneo por tienda, uno en curso: los enlaces caducan a los 30 minutos. */
export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(
      403,
      "forbidden",
      "Solo el propietario de la organización puede conectar el número"
    );
  }
  const token = llaveMaestra();
  if (!token) return new Response(null, { status: 404 });

  // El body es opcional: el botón de arrancar un escaneo no manda nada, y el de
  // reconectar manda `{reconectar:true}`. Un JSON mal formado no puede ser un
  // error de validación, así que se ignora en vez de responder 422.
  const cuerpo = (await req.json().catch(() => null)) as {
    reconectar?: unknown;
  } | null;
  const reconectar = cuerpo?.reconectar === true;

  const db = getDb();
  const [org] = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, session.organizationId))
    .limit(1);
  const nombre = org?.name?.trim() || "Tienda";

  const actual = await getCredentialsByOrg(session.organizationId);
  if (actual && !hablaPorZernio(actual)) {
    return apiError(
      409,
      "canal_meta",
      "Este número está conectado con la Cloud API de Meta; desconéctalo antes de usar el escaneo"
    );
  }

  try {
    const perfil = await perfilDeOrg(token, {
      organizationId: session.organizationId,
      name: nombre,
    });
    const inicio = await iniciarConexion(token, {
      profileId: perfil.id,
      brandName: nombre,
      reconnectAccountId: reconectar ? (actual?.accountRef ?? null) : null,
    });

    if (inicio.modo === "connected") {
      // Zernio reactivó una cuenta desconectada y devolvió la cuenta en vez de
      // un link: no hay nada que escanear, se guarda aquí mismo.
      const guardado = await conectarCuenta({
        organizationId: session.organizationId,
        token,
        profileId: perfil.id,
        cuenta: inicio.cuenta,
      });
      return respuestaDelGuardado(guardado);
    }

    // «Uno en curso por tienda»: un enlace que no se escaneó caduca solo en
    // Zernio, pero aquí la fila seguiría viva y un reinicio tras otro llenaría
    // la tabla de escaneos que nadie consumió.
    await db
      .delete(schema.zernioHandoff)
      .where(
        and(
          eq(schema.zernioHandoff.organizationId, session.organizationId),
          inArray(schema.zernioHandoff.status, ["waiting", "opened"])
        )
      );

    await db.insert(schema.zernioHandoff).values({
      id: inicio.handoffId,
      organizationId: session.organizationId,
      profileId: perfil.id,
      status: "waiting",
      expiresAt: inicio.expiresAt ? new Date(inicio.expiresAt) : null,
    });

    return Response.json({
      estado: "qr",
      handoffId: inicio.handoffId,
      url: inicio.url,
      expiresAt: inicio.expiresAt,
      // La cuenta atrás viaja como duración, no como instante. El reloj del
      // navegador no es de fiar — una máquina adelantada horas leería caducado
      // un enlace vivo y cortaría un escaneo que iba bien — y aquí pasó.
      quedanSegundos: segundosRestantes(inicio.expiresAt),
    });
  } catch (err) {
    return errorDeZernio(err);
  }
});

const getSchema = z.object({ handoffId: z.string().min(8) });

/**
 * Sondea el escaneo y, cuando termina, conecta el número.
 *
 * El estado terminal se responde desde la fila y no volviendo a Zernio: un
 * `connected` ya consumido no debe volver a pasar por las guardas cada tres
 * segundos mientras el navegador tarda en recargar la tarjeta.
 */
export const GET = withAuth(async (session, req: Request) => {
  const token = llaveMaestra();
  if (!token) return new Response(null, { status: 404 });

  const url = new URL(req.url);
  const parseado = getSchema.safeParse({
    handoffId: url.searchParams.get("handoffId") ?? "",
  });
  if (!parseado.success) {
    return apiError(422, "invalid_body", "Falta el identificador del escaneo");
  }
  const handoffId = parseado.data.handoffId;

  const db = getDb();
  const [fila] = await db
    .select()
    .from(schema.zernioHandoff)
    .where(
      and(
        eq(schema.zernioHandoff.id, handoffId),
        // Y no solo por id: sin esta segunda condición, conocer el id de otro
        // escaneo bastaría para conectar su número a esta tienda.
        eq(schema.zernioHandoff.organizationId, session.organizationId)
      )
    )
    .limit(1);
  if (!fila) {
    return apiError(404, "handoff_no_encontrado", "Este escaneo ya no existe");
  }

  const marcar = (set: Partial<typeof schema.zernioHandoff.$inferInsert>) =>
    db
      .update(schema.zernioHandoff)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(schema.zernioHandoff.id, handoffId));

  if (fila.status === "connected") return estadoYaGuardado(session.organizationId);
  if (fila.status === "failed") {
    return Response.json({
      estado: "failed",
      codigo: fila.errorCode,
      mensaje: mensajeDelEscaneo(fila.errorCode, fila.errorMessage, false),
    });
  }
  if (fila.status === "expired") {
    return Response.json({ estado: "expired", mensaje: mensajeDelEscaneo(null, null, true) });
  }

  let estado: Awaited<ReturnType<typeof estadoHandoff>>;
  try {
    estado = await estadoHandoff(token, handoffId);
  } catch (err) {
    return errorDeZernio(err);
  }

  if (estado.estado === "waiting" || estado.estado === "opened") {
    if (fila.status !== estado.estado) await marcar({ status: estado.estado });
    return Response.json({ estado: estado.estado });
  }

  if (estado.estado === "expired") {
    await marcar({ status: "expired" });
    return Response.json({ estado: "expired", mensaje: mensajeDelEscaneo(null, null, true) });
  }

  if (estado.estado === "failed") {
    await marcar({
      status: "failed",
      errorCode: estado.codigo,
      errorMessage: estado.mensaje || null,
    });
    return Response.json({
      estado: "failed",
      codigo: estado.codigo,
      loArreglaElUsuario: estado.loArreglaElUsuario,
      mensaje: mensajeDelEscaneo(estado.codigo, estado.mensaje, false),
    });
  }

  const cuenta = elegirCuenta(estado.cuentas);
  if (!cuenta) {
    await marcar({
      status: "failed",
      errorCode: "connect_incomplete",
      errorMessage: "Zernio respondió conectado sin traer ninguna cuenta",
    });
    return Response.json({
      estado: "failed",
      codigo: "connect_incomplete",
      loArreglaElUsuario: true,
      mensaje: "El escaneo terminó sin número: vuelve a intentarlo.",
    });
  }

  const guardado = await conectarCuenta({
    organizationId: session.organizationId,
    token,
    profileId: fila.profileId,
    cuenta,
  });
  if (!guardado.ok) {
    // El fallo es del CRM (el número ya era de otra tienda), no del teléfono,
    // pero se guarda igual: es terminal y el sondeo no debe reabrirlo.
    await marcar({ status: "failed", errorCode: guardado.code, errorMessage: guardado.message });
    return Response.json({
      estado: "failed",
      codigo: guardado.code,
      mensaje: guardado.message,
    });
  }

  await marcar({ status: "connected", accountRef: cuenta.id });
  return respuestaDelGuardado(guardado);
});

/**
 * Con la coexistencia Zernio devuelve un número, pero el endpoint es el mismo
 * de los flujos que eligen varias páginas o ubicaciones. Si vinieran varios,
 * quedarse con el primero al azar repartiría mensajes de otra cuenta: se exige
 * uno solo y si no, se lo dice a quien conecta.
 */
function elegirCuenta(cuentas: CuentaConectada[]): CuentaConectada | null {
  if (cuentas.length === 1) return cuentas[0]!;
  return null;
}

function respuestaDelGuardado(guardado: ResultadoConexion): Response {
  if (guardado.ok) {
    return Response.json({
      estado: "connected",
      connection: guardado.connection,
      webhookOk: guardado.webhookOk,
    });
  }
  return Response.json(
    { error: { code: guardado.code, message: guardado.message } },
    { status: guardado.status }
  );
}

/** El escaneo ya consumido: se responde lo que quedó guardado, sin ir a Zernio. */
async function estadoYaGuardado(organizationId: string): Promise<Response> {
  const creds = await getCredentialsByOrg(organizationId);
  return Response.json({
    estado: "connected",
    connection: creds
      ? {
          source: "zernio" as const,
          accountRef: creds.accountRef,
          displayPhoneNumber: creds.displayPhoneNumber,
          status: creds.status,
          tokenLast4: tokenLast4(creds.token),
        }
      : null,
    webhookOk: creds?.webhookSecret !== null,
  });
}

/**
 * Los códigos de Zernio en lo que el dueño de la tienda puede hacer.
 *
 * Se traducen aquí y no en la tarjeta porque son de Zernio: si mañana cambia un
 * código, el aviso cambia en un solo sitio. Lo que no se traduce se muestra
 * crudo — un `whatsapp_error` con el detalle de Meta dentro es información que
 * nadie más que RAE va a interpretar, y ocultarla no la arregla.
 */
function mensajeDelEscaneo(
  codigo: string | null,
  detalle: string | null,
  expirado: boolean
): string {
  if (expirado) {
    return "El enlace caducó: dura 30 minutos. Pide uno nuevo y escanéalo.";
  }
  switch (codigo) {
    case "whatsapp_coexistence_not_registered":
      return "El número no aparece en la app de WhatsApp Business de ese teléfono. Con WhatsApp normal no se puede conectar: abre la app de Business e inténtalo otra vez.";
    case "one_whatsapp_per_profile":
      return "Este perfil de Zernio ya tiene un número de WhatsApp. Desconecta el anterior o pide otro perfil.";
    case "whatsapp_number_already_connected":
      return "Ese número ya está conectado en Zernio desde otra cuenta.";
    case "whatsapp_number_pinned_to_profile":
      return "Ese número quedó anclado a otro perfil de Zernio y no se puede mover desde aquí.";
    case "payment_required":
      return "La cuenta de Zernio está pausada por el pago; se reanuda al pagarlo.";
    case "connection_cancelled":
      return "Se cerró la pantalla antes de terminar. Vuelve a escanear.";
    case "session_expired":
      return "El escaneo tardó demasiado. Pide un enlace nuevo.";
    case "account_mismatch":
      return "Se inició con un login de Facebook distinto del que se pidió para esta tienda.";
    case "connect_unverified":
      return "Zernio no pudo casar la cuenta conectada con este escaneo.";
    case "connect_incomplete":
      return "El teléfono no llegó a terminar el proceso.";
    default:
      return detalle?.trim() || "No se pudo conectar el número desde el teléfono.";
  }
}
