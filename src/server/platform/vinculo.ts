import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * A qué tienda de UNIKO-RD pertenece este espacio: el puente entre la
 * organización del CRM y el catálogo que el bot consulta.
 *
 * Es un dato que pone RAE desde el panel, no el cliente: el `store_id` sale del
 * proyecto Supabase de la tienda y un error ahí hace que el bot conteste con el
 * catálogo de otro negocio. Por eso se guarda en una columna aparte
 * (`organization.uniko_store_id`, migración 0021) y no en `metadata`.
 *
 * Vacío es un estado válido y normal: una tienda que todavía no está en UNIKO
 * no tiene vínculo, y el turno simplemente no llama a nadie.
 */

export type VinculoUniko = { organizationId: string; storeId: string | null };

/**
 * Los `store_id` de UNIKO-RD son SLUGS de texto (`stores.id` es `text`, no
 * uuid): `tech-store-rd`, y los que crea la web salen de `slugUnico()`, o sea
 * `slugify(nombre)` + un sufijo al azar. Validar un UUID aquí rechazaba todas
 * las tiendas reales y dejaba el vínculo imposible de poner.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LARGO_MAXIMO = 64;

export class StoreIdInvalido extends Error {
  constructor() {
    super("El id de tienda de UNIKO es el slug de la tabla `stores` (p. ej. `tech-store-rd`)");
    this.name = "StoreIdInvalido";
  }
}

export async function ponerVinculoUniko(
  organizationId: string,
  storeId: string | null | undefined
): Promise<VinculoUniko | null> {
  const limpio = storeId?.trim() ?? "";
  if (limpio && (limpio.length > LARGO_MAXIMO || !SLUG.test(limpio))) {
    throw new StoreIdInvalido();
  }
  const filas = await getDb()
    .update(schema.organization)
    .set({ unikoStoreId: limpio || null })
    .where(eq(schema.organization.id, organizationId))
    .returning({ id: schema.organization.id });
  const org = filas[0];
  if (!org) return null;
  return { organizationId: org.id, storeId: limpio || null };
}

/** El id de la tienda vinculada, o null. Lo pregunta el turno antes de la red. */
export async function storeIdDeTienda(
  organizationId: string
): Promise<string | null> {
  const filas = await getDb()
    .select({ storeId: schema.organization.unikoStoreId })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return filas[0]?.storeId ?? null;
}
