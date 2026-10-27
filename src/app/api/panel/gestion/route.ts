import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withPanel } from "@/lib/api";
import { COOKIE_GESTION } from "@/lib/auth/platform";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const cuerpo = z.object({ organizationId: z.string().min(1) });

/** Horas que dura una sesión de gestión: se corta sola, no queda abierta. */
const MAX_AGE = 60 * 60 * 8;

/**
 * Entrar / salir del modo gestión de una tienda.
 *
 * Solo escribe una cookie con el `organization_id`; lo que la hace valer es
 * `orgEnGestion()`, que exige que el correo de la sesión esté en
 * `PLATFORM_ADMIN_EMAILS`. Por eso un cliente que se invente la cookie no
 * obtiene nada: su correo no está en la lista.
 */
export const POST = withPanel(async (_admin, req: Request) => {
  const parsed = await parseBody(req, cuerpo);
  if (!parsed.ok) return parsed.response;
  const filas = await getDb()
    .select({ id: schema.organization.id, nombre: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, parsed.data.organizationId))
    .limit(1);
  const org = filas[0];
  if (!org) {
    return apiError(404, "not_found", "Esa tienda no existe en la instancia");
  }
  (await cookies()).set(COOKIE_GESTION, org.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return Response.json({ organizationId: org.id, nombre: org.nombre });
});

/** Salir: la cookie desaparece y la sesión vuelve a la tienda del usuario. */
export const DELETE = withPanel(async () => {
  (await cookies()).delete(COOKIE_GESTION);
  return Response.json({ ok: true });
});
