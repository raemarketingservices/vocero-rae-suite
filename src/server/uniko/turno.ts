import { storeIdDeTienda } from "@/server/platform/vinculo";
import { leerConfigUniko } from "./config";
import {
  bloqueDeExistencias,
  bloqueDeTienda,
  buscarExistencias,
  perfilDeTienda,
} from "./inventario";

/**
 * El bloque de UNIKO-RD del turno (perfil de la tienda + productos), o `null`
 * si en esta instancia no hay catálogo que consultar.
 *
 * Dos guardas antes de tocar la red: la bandera de entorno y que la
 * organización tenga tienda vinculada (`organization.uniko_store_id`). Una
 * tienda que aún no está en UNIKO-RD no paga una llamada por mensaje.
 *
 * Si el mensaje no nombra ningún producto, se manda una muestra del catálogo
 * para que el bot pueda contestar "¿qué venden?".
 */
export async function bloqueDeExistenciasParaTurno(
  organizationId: string,
  textoDelMensaje: string | null | undefined
): Promise<string | null> {
  const config = leerConfigUniko();
  if (!config.active) return null;

  const storeId = await storeIdDeTienda(organizationId);
  if (!storeId) return null;

  const [perfil, coincidencias] = await Promise.all([
    perfilDeTienda(storeId, config),
    buscarExistencias(storeId, textoDelMensaje, config),
  ]);
  const sinTexto = !textoDelMensaje?.trim();
  const sinCoincidencias = coincidencias.ok && coincidencias.productos.length === 0;
  const busqueda =
    sinCoincidencias && !sinTexto
      ? await buscarExistencias(storeId, "", config)
      : coincidencias;

  const bloques = [
    bloqueDeTienda(perfil, config),
    bloqueDeExistencias(busqueda, config, sinTexto || sinCoincidencias),
  ].filter(Boolean);
  return bloques.length ? bloques.join("\n\n") : null;
}
