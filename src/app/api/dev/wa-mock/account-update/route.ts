import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import {
  getCredentialsByPhoneNumberId,
  getCredentialsByWabaId,
} from "@/server/whatsapp/credentials";
import {
  buildAccountUpdatePayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

/**
 * Simula `account_update`: el dueño desconectó la cuenta desde su teléfono
 * (`ACCOUNT_OFFBOARDED`), la reconectó (`ACCOUNT_RECONNECTED`) o le quitó el
 * acceso a la app (`PARTNER_REMOVED`).
 *
 * `sinMetadata` deja el payload como llega de verdad: a nivel WABA, sin
 * `phone_number_id`, de modo que el CRM tiene que enrutarlo por `entry.id`.
 * Solo en el entorno de pruebas (dev-guard).
 */
const schema = z
  .object({
    wabaId: z.string().min(1).optional(),
    phoneNumberId: z.string().min(1).optional(),
    event: z.string().min(1),
    reason: z.string().optional(),
    initiatedBy: z.string().optional(),
    sinMetadata: z.boolean().optional(),
  })
  .refine((d) => d.wabaId || d.phoneNumberId, {
    message: "Se necesita wabaId o phoneNumberId",
  });

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { sinMetadata, phoneNumberId, wabaId, ...resto } = body.data;

  const creds = phoneNumberId
    ? await getCredentialsByPhoneNumberId(phoneNumberId)
    : await getCredentialsByWabaId(wabaId!);

  const payload = buildAccountUpdatePayload({
    ...resto,
    wabaId: wabaId ?? creds?.wabaId ?? "WABA-MOCK",
    phoneNumberId: sinMetadata ? undefined : phoneNumberId,
  });
  const res = await deliverToWebhook(payload);
  if (!res.ok) {
    return apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
  }
  return Response.json({ delivered: true, wabaId: payload.entry[0]!.id });
}
