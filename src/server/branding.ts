import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/lib/db";
import { getSessionOrNull } from "@/lib/auth/session";
import {
  normalizeBranding,
  type Branding,
} from "@/lib/branding";
import { getPlatformBrandingContext } from "@/server/platform-branding";

/** Marca guardada en organization.metadata (JSON de Better Auth). */

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Marca + a qué organización pertenece.
 *
 * El icono se guarda como archivo en `MEDIA_DIR/{organizationId}/favicon`, así
 * que servirlo necesita el id — y la ruta que lo sirve es pública (el login
 * también tiene pestaña), donde no hay sesión de la que sacarlo.
 *
 * Sin organización —login, registro, layout raíz, o un id que ya no existe—
 * la marca es la de la PLATAFORMA, no la de un cliente: en una instancia
 * multi-tenant las páginas públicas son de RAE y enseñar ahí la marca de un
 * espacio cualquiera filtraría su nombre y su logo a los demás.
 */
export async function getBrandingContext(
  organizationId?: string | null
): Promise<{ organizationId: string | null; branding: Branding }> {
  if (!organizationId) return await getPlatformBrandingContext();
  const db = getDb();
  const rows = await db
    .select({ id: schema.organization.id, metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!rows[0]) return await getPlatformBrandingContext();
  const meta = parseMetadata(rows[0].metadata);
  return {
    organizationId: rows[0].id,
    branding: normalizeBranding(
      (meta.branding as Partial<Branding> | undefined) ?? null
    ),
  };
}

export async function getBranding(
  organizationId?: string | null
): Promise<Branding> {
  return (await getBrandingContext(organizationId)).branding;
}

/**
 * La marca de QUIEN MIRA, resuelta una sola vez por petición.
 *
 * El layout raíz la necesita para inyectar el acento y el `<title>`, y el
 * layout de la app para pintar la barra lateral: sin `cache()`, cada página
 * pagaba dos veces la misma sesión y la misma fila de `organization`.
 *
 * La regla para el admin de plataforma es que vea LA PLATAFORMA: su marca no
 * es la de una tienda más, así que fuera del modo gestión se le sirve la marca
 * global —la que él mismo edita en `/panel/marca`— y solo cuando entra a una
 * tienda concreta (`session.gestion`) ve el CRM con la marca de ESA tienda, que
 * es justo lo que el modo gestión existe para poder mirar.
 */
export const brandingDePeticion = cache(async (): Promise<{
  organizationId: string | null;
  branding: Branding;
}> => {
  const session = await getSessionOrNull();
  if (!session) return await getPlatformBrandingContext();
  if (session.adminDePlataforma && !session.gestion) {
    return await getPlatformBrandingContext();
  }
  return await getBrandingContext(session.organizationId);
});

export async function saveBranding(
  organizationId: string,
  /** `Partial` porque normaliza dentro: lo que falte cae al valor por defecto. */
  branding: Partial<Branding>
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.branding = normalizeBranding(branding);
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}
