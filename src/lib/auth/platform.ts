import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

/**
 * Administrador de la plataforma RAE.
 *
 * No es un rol de `member`: ese vive dentro de UNA organización y aquí hace
 * falta verlas todas. La llave es una lista de correos en
 * `PLATFORM_ADMIN_EMAILS`; sin la variable, el panel no existe para nadie y
 * toda su superficie responde 404, igual que las demás features opcionales
 * (ADR-001).
 *
 * La otra mitad es el modo gestión: el admin elige una tienda en el panel, se
 * guarda su `organization_id` en una cookie y `requireSession()` la usa como
 * organización activa. Con eso las pantallas de siempre (WhatsApp, IA,
 * Messenger, marca, equipo) funcionan sobre la tienda elegida sin reescribir
 * un solo formulario, y el cliente nunca ve al admin en su lista de Equipo
 * porque no se le crea ninguna `member`.
 */
export const COOKIE_GESTION = "rae_gestion";

/** Correos de la lista, normalizados. Vacío o basura → nadie es admin. */
export function parseAdminEmails(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const parte of (raw ?? "").split(",")) {
    const limpio = parte.trim().toLowerCase();
    if (limpio) out.add(limpio);
  }
  return out;
}

/**
 * Se lee `process.env` directo, como las otras banderas (`agenda/flag.ts`):
 * preguntar quién manda no puede depender de que todo el entorno valide.
 */
export function esAdminDePlataforma(
  email: string | null | undefined
): boolean {
  if (!email) return false;
  return parseAdminEmails(process.env.PLATFORM_ADMIN_EMAILS).has(
    email.trim().toLowerCase()
  );
}

/** ¿Esta instancia tiene administrador de plataforma? */
export function hayAdminDePlataforma(): boolean {
  return parseAdminEmails(process.env.PLATFORM_ADMIN_EMAILS).size > 0;
}

export type OrgEnGestion = { organizationId: string; nombre: string };

/**
 * La sesión de un admin de plataforma, o `null`.
 *
 * Se llama así —y no mirando `requireSession()`— porque el panel y sus rutas
 * necesitan saber si quien pide entrar en otra tienda tiene llave para eso, y
 * `requireSession()` ya devuelve la tienda elegida: sería preguntar por el
 * resultado de lo que se quiere comprobar.
 */
export async function sesionEsAdminPlataforma(): Promise<{
  userId: string;
  email: string;
} | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session || !esAdminDePlataforma(session.user.email)) return null;
  return { userId: session.user.id, email: session.user.email };
}

/**
 * Tienda que el admin eligió en el panel, o `null`.
 *
 * La cookie se respeta SOLO si el correo de la sesión está en la lista: puesta
 * a mano por un cliente, no vale nada. Y se comprueba que la organización
 * exista, para que una tienda borrada no deje la sesión apuntando al vacío.
 */
export async function orgEnGestion(
  email: string | null | undefined
): Promise<OrgEnGestion | null> {
  if (!esAdminDePlataforma(email)) return null;
  const valor = (await cookies()).get(COOKIE_GESTION)?.value;
  if (!valor) return null;
  const filas = await getDb()
    .select({ id: schema.organization.id, nombre: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, valor))
    .limit(1);
  const fila = filas[0];
  return fila ? { organizationId: fila.id, nombre: fila.nombre } : null;
}
