import { sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { runInternalSignup } from "@/server/auth/internal-signup";
import { crearEspacioCliente } from "@/server/auth/on-signup";

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
