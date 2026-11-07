import { rm } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { runInternalSignup } from "@/server/auth/internal-signup";
import { crearEspacioCliente } from "@/server/auth/on-signup";
import { parseAdminEmails } from "@/lib/auth/platform";
import { mediaFilePath } from "@/server/whatsapp/media";

/**
 * Alta de una tienda desde el panel de la plataforma.
 *
 * Con `ALLOW_SIGNUP=false` el registro público está cerrado —es el modo en que
 * se vende: quien da de alta al cliente es RAE—, así que el panel tiene que
 * poder crear el espacio él mismo. Lo hace por el camino interno (`runInternalSignup`),
 * que atraviesa el gate sin reabrirlo para nadie más, y siembra la organización
 * con `crearEspacioCliente`, que es exactamente lo que haría el registro.
 */

/** Sin vocales ni caracteres pareados: la llave se dicta por teléfono o se pega en un correo. */
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const nano = customAlphabet(ALPHA, 14);

export function generarContrasena(): string {
  return nano();
}

export class CorreoEnUso extends Error {
  constructor() {
    super("Ese correo ya tiene una cuenta");
    this.name = "CorreoEnUso";
  }
}

export type TiendaNueva = {
  organizationId: string;
  nombre: string;
  email: string;
  /** La contraseña con la que entra el cliente: se enseña una sola vez. */
  password: string;
};

export async function crearTienda(input: {
  nombre: string;
  email: string;
  password?: string;
}): Promise<TiendaNueva> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const chocan = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${email}`)
    .limit(1);
  if (chocan.length > 0) throw new CorreoEnUso();

  const password = input.password?.trim() || generarContrasena();
  const nombre = input.nombre.trim();
  const creado = await runInternalSignup(async () =>
    getAuth().api.signUpEmail({ body: { name: nombre, email, password } })
  );
  // El gancho `onUserCreated` no sembró nada (va por el camino interno), así
  // que el espacio se crea aquí con el nombre del NEGOCIO, no con "Negocio de…".
  const organizationId = await crearEspacioCliente(creado.user.id, nombre, nombre);
  return { organizationId, nombre, email, password };
}

export class TiendaPropia extends Error {
  constructor() {
    super("No puedes eliminar una tienda de la que eres miembro");
    this.name = "TiendaPropia";
  }
}

/**
 * Baja definitiva de una tienda desde el panel.
 *
 * Todas las tablas de dominio cuelgan de `organization` con `ON DELETE
 * CASCADE`, así que borrar la fila se lleva conversaciones, contactos,
 * credenciales, agente… de una vez. Las cuentas que se quedan sin ninguna
 * tienda se borran también (si no, podrían entrar a un espacio vacío); las que
 * pertenecen a otra tienda, o son admins de la plataforma, se conservan.
 * Un admin no puede borrar una tienda de la que es miembro: es su propia casa.
 *
 * Devuelve `false` si la tienda no existe.
 */
export async function eliminarTienda(
  organizationId: string,
  adminUserId: string
): Promise<boolean> {
  const admins = [...parseAdminEmails(process.env.PLATFORM_ADMIN_EMAILS)];
  const existia = await getDb().transaction(async (tx) => {
    const miembros = await tx
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(eq(schema.member.organizationId, organizationId));
    if (miembros.some((m) => m.userId === adminUserId)) throw new TiendaPropia();

    const borradas = await tx
      .delete(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .returning({ id: schema.organization.id });
    if (borradas.length === 0) return false;

    const ids = miembros.map((m) => m.userId);
    if (ids.length > 0) {
      await tx.execute(sql`
        delete from "user" u
        where u.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
          and not exists (select 1 from member m where m.user_id = u.id)
          and lower(u.email) not in (${sql.join(
            (admins.length ? admins : [""]).map((e) => sql`${e}`),
            sql`, `
          )})
      `);
    }
    return true;
  });
  // Los archivos (logo, adjuntos) viven fuera de la base: carpeta por tienda.
  if (existia) {
    await rm(path.dirname(mediaFilePath(organizationId, "x")), {
      recursive: true,
      force: true,
    }).catch(() => null);
  }
  return existia;
}
