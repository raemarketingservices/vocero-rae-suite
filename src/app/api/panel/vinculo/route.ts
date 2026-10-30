import { z } from "zod";
import { apiError, parseBody, withPanel } from "@/lib/api";
import { ponerVinculoUniko, StoreIdInvalido } from "@/server/platform/vinculo";
import {
  inventarioUnikoActivo,
  inventarioUnikoDisabledResponse,
} from "@/server/uniko/config";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  organizationId: z.string().min(1),
  // `null` o vacío = quitar el vínculo. Es una opción, no un descuido: una
  // tienda que aún no está en UNIKO-RD no debe consultar a nadie.
  storeId: z.string().trim().max(64).nullish(),
});

/**
 * Vincular la organización con su tienda de UNIKO-RD.
 *
 * El `store_id` es lo que le dice al agente de qué catálogo hablar: el turno
 * consulta el stock vivo de ESA tienda (`server/uniko/turno.ts`). Se pone desde
 * el panel y no desde Ajustes porque un id equivocado haría que el bot conteste
 * con los precios y existencias de otro cliente, y porque el navegador del
 * cliente no tiene por qué saber que existe UNIKO. Vacío = sin vínculo: la
 * tienda sigue funcionando solo con su knowledge base.
 */
export const POST = withPanel(async (_admin, req: Request) => {
  if (!inventarioUnikoActivo()) return inventarioUnikoDisabledResponse();
  const parsed = await parseBody(req, cuerpo);
  if (!parsed.ok) return parsed.response;
  try {
    const vinculo = await ponerVinculoUniko(
      parsed.data.organizationId,
      parsed.data.storeId
    );
    if (!vinculo) {
      return apiError(404, "not_found", "Esa tienda no existe en la instancia");
    }
    return Response.json(vinculo);
  } catch (err) {
    if (err instanceof StoreIdInvalido) return apiError(422, "store_id_invalido", err.message);
    throw err;
  }
});
