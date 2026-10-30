import { storeIdDeTienda } from "@/server/platform/vinculo";
import { leerConfigUniko } from "./config";
import { bloqueDeExistencias, buscarExistencias } from "./inventario";

/**
 * El bloque de existencias del turno, o `null` si en esta instancia no hay
 * catálogo que consultar.
 *
 * Dos guardas antes de tocar la red: la bandera de entorno y que la
 * organización tenga tienda vinculada (`organization.uniko_store_id`). Una
 * tienda que aún no está en UNIKO-RD no paga una llamada por mensaje.
 */
export async function bloqueDeExistenciasParaTurno(
  organizationId: string,
  textoDelMensaje: string | null | undefined
): Promise<string | null> {
  const config = leerConfigUniko();
  if (!config.active) return null;

  const storeId = await storeIdDeTienda(organizationId);
  if (!storeId) return null;

  const busqueda = await buscarExistencias(storeId, textoDelMensaje, config);
  return bloqueDeExistencias(busqueda, config);
}
