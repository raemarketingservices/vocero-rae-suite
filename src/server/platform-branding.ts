import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_BRANDING,
  normalizeBranding,
  type Branding,
  type BrandingFavicon,
} from "@/lib/branding";

/**
 * La marca de la instancia: la que ven las páginas públicas y el cascarón del
 * panel. Cada tienda tiene la suya en `organization.metadata` y esa NO toca
 * esta; mover esta es decisión del admin de la plataforma.
 */

/** La tabla tiene una sola fila y su id es fijo: no hay dónde elegir otra. */
export const PLATFORM_BRAND_ID = "platform";

/**
 * Carpeta del volumen de medios donde vive el logo de la plataforma. No es un
 * `organizationId`, y el carácter de reserva lo decide `assertSafeSegment`
 * (guion bajo entra en `\w`), así que ninguna tienda real puede chocar.
 */
export const PLATFORM_LOGO_DIR = "__plataforma__";

function parseLogo(value: unknown): BrandingFavicon | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.mime !== "string" || !Number.isFinite(v.version)) return null;
  return { mime: v.mime, version: Math.max(1, Math.floor(v.version as number)) };
}

export async function getPlatformBrandingContext(): Promise<{
  organizationId: null;
  branding: Branding;
}> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.platformBrand)
    .where(eq(schema.platformBrand.id, PLATFORM_BRAND_ID))
    .limit(1);
  const row = rows[0];
  // Sin fila (instalación recién migrada) la marca es la del código: RAE con
  // su azul de guía de estilo. `DEFAULT_BRANDING` sigue siendo el respaldo.
  if (!row) return { organizationId: null, branding: DEFAULT_BRANDING };
  return {
    organizationId: null,
    branding: normalizeBranding({
      name: row.name,
      accent: row.accent,
      description: row.description,
      currency: DEFAULT_BRANDING.currency,
      favicon: parseLogo(row.logo),
    }),
  };
}

export async function getPlatformBranding(): Promise<Branding> {
  return (await getPlatformBrandingContext()).branding;
}

/** Guarda nombre, color y descripción; el logo lo escribe su propia ruta. */
export async function savePlatformBranding(
  branding: Branding,
  logo?: BrandingFavicon | null
): Promise<void> {
  const db = getDb();
  const limpio = normalizeBranding(branding);
  const values = {
    name: limpio.name,
    accent: limpio.accent,
    description: limpio.description,
    // `undefined` = no se tocó aquí, se conserva lo que estaba.
    ...(logo === undefined ? {} : { logo: logo ?? null }),
    updatedAt: new Date(),
  };
  const rows = await db
    .update(schema.platformBrand)
    .set(values)
    .where(eq(schema.platformBrand.id, PLATFORM_BRAND_ID))
    .returning({ id: schema.platformBrand.id });
  if (rows.length > 0) return;
  await db
    .insert(schema.platformBrand)
    .values({
      id: PLATFORM_BRAND_ID,
      name: limpio.name,
      accent: limpio.accent,
      description: limpio.description,
      logo: logo ?? null,
    })
    .onConflictDoNothing();
}
