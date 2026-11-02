import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getWaMockState } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * Sembra y lee el estado de coexistence del mock de Meta.
 *
 * POST — deja un número como montado en la app de WhatsApp Business del
 * teléfono (`is_on_biz_app`) y fija los campos suscritos de la app. Los campos
 * NO se pueden suscribir por API para WhatsApp (se ponen una vez en el panel),
 * así que el harness tiene que poder sembrarlos a mano: sin esto, el diagnóstico
 * del CRM solo se podría probar en el caso "Meta no reporta nada".
 *
 * `onBizApp: null` simula el número cuyo campo no se reporta; `null` en
 * `subscribedFields` simula la app que no reporta sus campos.
 *
 * GET — lo que el mock sabe y lo que el CRM le pidió: sobre todo los
 * `smb_app_data`, porque en Meta el relleno es de un solo uso y hay que poder
 * comprobar que no se pidió dos veces ni cuando el número no está en la app.
 */
const schema = z.object({
  phoneNumberId: z.string().min(1).optional(),
  /** `true`/`false`/`null` (no se reporta). */
  onBizApp: z.boolean().nullable().optional(),
  platformType: z.string().nullable().optional(),
  wabaId: z.string().min(1).optional(),
  subscribedFields: z.array(z.string().min(1)).nullable().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { phoneNumberId, onBizApp, platformType, wabaId, subscribedFields } =
    body.data;
  if (!phoneNumberId && !wabaId) {
    return apiError(422, "sin_destino", "Se necesita phoneNumberId o wabaId");
  }

  const state = getWaMockState();
  if (phoneNumberId && (onBizApp !== undefined || platformType !== undefined)) {
    const actual = state.phoneCoexistence[phoneNumberId] ?? {
      onBizApp: false,
      platformType: "CLOUD_API",
    };
    state.phoneCoexistence[phoneNumberId] = {
      onBizApp: onBizApp === undefined ? actual.onBizApp : onBizApp,
      platformType:
        platformType === undefined ? actual.platformType : platformType,
    };
    // Sembrar `onBizApp` a mano modela un alta nueva de la app del teléfono, y
    // en Meta el relleno es de un solo uso POR CONEXIÓN: sin reiniciar la cola,
    // re-correr el self-test contra el mismo proceso vería «ya solicitada» en
    // el primer guardado y no podría medir el caso feliz.
    if (onBizApp !== undefined) {
      state.smbAppDataRequests = state.smbAppDataRequests.filter(
        (r) => r.phoneNumberId !== phoneNumberId
      );
    }
  }
  if (wabaId && subscribedFields !== undefined) {
    state.wabaSubscriptions[wabaId] = {
      ...state.wabaSubscriptions[wabaId],
      overrideCallbackUri:
        state.wabaSubscriptions[wabaId]?.overrideCallbackUri ?? null,
      subscribedFields,
    };
  }
  return Response.json({ ok: true });
}

export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;

  const state = getWaMockState();
  return Response.json({
    phoneCoexistence: state.phoneCoexistence,
    wabaSubscriptions: state.wabaSubscriptions,
    smbAppDataRequests: state.smbAppDataRequests,
  });
}
