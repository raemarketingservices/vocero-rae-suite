import { z } from "zod";
import { parseBody, withPanel } from "@/lib/api";
import { MAX_BRANDING_DESCRIPTION, isValidHex } from "@/lib/branding";
import {
  getPlatformBranding,
  savePlatformBranding,
} from "@/server/platform-branding";

export const dynamic = "force-dynamic";

/**
 * La marca de la PLATAFORMA: la que ven quien no ha entrado (login, registro,
 * pestaña) y el cascarón del panel. Es una sola fila para toda la instancia y
 * solo la mueve el admin de plataforma (`PLATFORM_ADMIN_EMAILS`).
 *
 * No es el endpoint de marca de una tienda —ese es `/api/settings/branding` y
 * escribe en `organization.metadata`— y ahí está la frontera que el usuario
 * pidió: lo que cambia una tienda cambia su CRM, lo que cambia aquí cambia la
 * plataforma, y nadie más que el admin puede hacerlo.
 */
const cuerpo = z.object({
  name: z.string().trim().min(1, "El nombre no puede quedar vacío").max(30),
  accent: z.string().refine(isValidHex, "Color hex inválido (#rrggbb)"),
  description: z.string().trim().max(MAX_BRANDING_DESCRIPTION).default(""),
});

export const GET = withPanel(async () => {
  return Response.json({ branding: await getPlatformBranding() });
});

export const PUT = withPanel(async (_admin, req: Request) => {
  const parsed = await parseBody(req, cuerpo);
  if (!parsed.ok) return parsed.response;
  const actual = await getPlatformBranding();
  // `currency` y el logo se conservan: este formulario es de nombre, color y
  // descripción, y el logo tiene su propia ruta por la misma razón que en las
  // tiendas (guardar el nombre no debe borrar el archivo).
  await savePlatformBranding({
    ...actual,
    name: parsed.data.name,
    accent: parsed.data.accent,
    description: parsed.data.description ?? "",
  });
  return Response.json({ ok: true });
});
