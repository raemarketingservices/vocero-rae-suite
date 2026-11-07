import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { ponerVinculoUniko, StoreIdInvalido } from "@/server/platform/vinculo";
import {
  inventarioUnikoActivo,
  inventarioUnikoDisabledResponse,
} from "@/server/uniko/config";
import { esDuenoDeTienda, perfilDeTienda } from "@/server/uniko/inventario";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  // Vacío o null = quitar el vínculo.
  storeId: z.string().trim().max(64).nullish(),
});

/**
 * El dueño vincula SU espacio con su tienda de UNIKO-RD (el admin lo hace por
 * `/api/panel/vinculo`). Antes de guardar se comprueba que la tienda exista y
 * esté publicada: un Store ID mal copiado dejaría al bot sin catálogo sin que
 * nadie se entere.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!inventarioUnikoActivo()) return inventarioUnikoDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede vincular la tienda");
  }
  const parsed = await parseBody(req, cuerpo);
  if (!parsed.ok) return parsed.response;
  const storeId = parsed.data.storeId?.trim() || null;
  if (storeId) {
    const perfil = await perfilDeTienda(storeId);
    if (perfil === "error") {
      return apiError(502, "uniko_caido", "No pudimos consultar UNIKO-RD. Intenta en un momento.");
    }
    if (!perfil) {
      return apiError(
        422,
        "tienda_no_encontrada",
        "No encontramos esa tienda en UNIKO-RD. Revisa el Store ID o espera a que la aprueben."
      );
    }
    // Solo el dueño real (mismo correo que su cuenta de UNIKO-RD) o el admin
    // de la plataforma: si no, cualquiera pondría su bot a vender la tienda de otro.
    if (!session.adminDePlataforma) {
      const filas = await getDb()
        .select({ email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, session.userId))
        .limit(1);
      const dueno = filas[0] ? await esDuenoDeTienda(storeId, filas[0].email) : false;
      if (dueno === "error") {
        return apiError(502, "uniko_caido", "No pudimos verificar el dueño en UNIKO-RD. Intenta en un momento.");
      }
      if (!dueno) {
        return apiError(
          403,
          "no_es_dueno",
          "Esa tienda no es tuya: tu correo del CRM debe ser el mismo de tu cuenta de vendedor en UNIKO-RD. Si es tuya, pide a RAE que la vincule."
        );
      }
    }
  }
  try {
    const vinculo = await ponerVinculoUniko(session.organizationId, storeId);
    if (!vinculo) return apiError(404, "not_found", "Tu espacio no existe");
    return Response.json(vinculo);
  } catch (err) {
    if (err instanceof StoreIdInvalido) return apiError(422, "store_id_invalido", err.message);
    throw err;
  }
});
