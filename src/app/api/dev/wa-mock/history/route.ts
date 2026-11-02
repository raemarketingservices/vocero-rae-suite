import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import {
  buildHistoryPayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

/**
 * Simula el relleno de coexistence (`history`): hasta 180 días de mensajes
 * anteriores al alta, en fases y trozos. Entrega el payload firmado al webhook
 * real, con la forma que Meta manda hoy (hilos anidados).
 *
 * Lo que se prueba con esto es sobre todo lo que NO debe pasar: el relleno no
 * abre la ventana de 24 h, no mueve el no-leído, no pausa a la IA y no dispara
 * al agente. Solo en el entorno de pruebas (dev-guard).
 */
const mensaje = z.object({
  from: z.string().optional(),
  text: z.string().optional(),
  type: z.string().optional(),
  waMessageId: z.string().optional(),
  timestamp: z.number().optional(),
  fromMe: z.boolean().optional(),
});

const schema = z.object({
  phoneNumberId: z.string().min(1),
  businessNumber: z.string().optional(),
  threads: z
    .array(z.object({ id: z.string().min(5), messages: z.array(mensaje).min(1) }))
    .min(1),
  phase: z.string().optional(),
  chunkOrder: z.number().optional(),
  progress: z.string().optional(),
  /** Variante con los hilos sueltos en `value.threads`. */
  useFlatThreads: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const creds = await getCredentialsByPhoneNumberId(body.data.phoneNumberId);
  const payload = buildHistoryPayload({
    ...body.data,
    wabaId: creds?.wabaId ?? "WABA-MOCK",
  });
  const res = await deliverToWebhook(payload);
  if (!res.ok) {
    return apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
  }
  return Response.json({
    delivered: true,
    mensajes: body.data.threads.reduce((n, t) => n + t.messages.length, 0),
  });
}
