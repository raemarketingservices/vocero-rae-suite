import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  completarRegistroInsertado,
  embeddedSignupConfig,
  embeddedSignupEnabled,
} from "@/server/whatsapp/embedded-signup";

/**
 * Superficie del registro insertado de Meta (Embedded Signup).
 *
 * GET  → lo que el navegador necesita para montar el SDK (IDs públicos; el
 *        secreto de la app nunca sale del servidor).
 * POST → termina el flujo: Meta dio un código de un solo uso, aquí se cambia
 *        por el token del cliente, se cifra y se registra el webhook.
 *
 * Sin las tres variables del registro insertado, el POST responde 404: en esta
 * instancia esa puerta no existe (el canal sigue funcionando en modo directo).
 */

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  return Response.json(embeddedSignupConfig());
});

const bodySchema = z.object({
  code: z.string().trim().min(1),
  wabaId: z.string().trim().min(1).optional(),
  phoneNumberId: z.string().trim().min(1).optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!embeddedSignupEnabled()) {
    return new Response(null, { status: 404 });
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const resultado = await completarRegistroInsertado({
    organizationId: session.organizationId,
    code: body.data.code,
    wabaId: body.data.wabaId,
    phoneNumberId: body.data.phoneNumberId,
  });

  if (!resultado.ok) {
    if (resultado.code === "varios_numeros") {
      return Response.json({ ok: false, code: resultado.code, numeros: resultado.numeros });
    }
    const status =
      resultado.code === "meta_indisponible"
        ? 503
        : resultado.code === "sin_configuracion"
          ? 500
          : 422;
    return apiError(status, resultado.code, resultado.message);
  }

  return Response.json({
    ok: true,
    wabaId: resultado.wabaId,
    phoneNumberId: resultado.phoneNumberId,
    displayPhoneNumber: resultado.displayPhoneNumber,
    verifiedName: resultado.verifiedName,
    webhook: resultado.webhook,
  });
});
