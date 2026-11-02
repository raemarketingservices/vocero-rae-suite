import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import {
  buildStateSyncPayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

/**
 * Simula `smb_app_state_sync`: la agenda del teléfono del dueño se sincroniza
 * hacia el CRM (altas y renombrados). `delete` se acepta en el payload porque
 * Meta lo manda, y se ignora: quitar un número del celular de alguien no puede
 * borrarle un cliente al negocio.
 *
 * Solo en el entorno de pruebas (dev-guard).
 */
const schema = z.object({
  phoneNumberId: z.string().min(1),
  businessNumber: z.string().optional(),
  contactos: z
    .array(
      z.object({
        phone: z.string().min(5),
        name: z.string().optional(),
        action: z.string().optional(),
        type: z.string().optional(),
      })
    )
    .min(1),
  /** Variante plana bajo `value.contacts`. */
  useFlatContacts: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const creds = await getCredentialsByPhoneNumberId(body.data.phoneNumberId);
  const payload = buildStateSyncPayload({
    ...body.data,
    wabaId: creds?.wabaId ?? "WABA-MOCK",
  });
  const res = await deliverToWebhook(payload);
  if (!res.ok) {
    return apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
  }
  return Response.json({ delivered: true, contactos: body.data.contactos.length });
}
