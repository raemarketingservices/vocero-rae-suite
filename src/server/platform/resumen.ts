import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { esAdminDePlataforma } from "@/lib/auth/platform";

/**
 * Lo que ve el administrador de la plataforma: LAS TIENDAS DE LA INSTANCIA,
 * no las de un cliente.
 *
 * Es el único sitio del CRM que consulta tablas de dominio SIN `scoped()`, y a
 * propósito: el panel necesita agrupar por organización, así que el tenant no
 * es un filtro sino la columna del resultado. La guardia no está aquí sino
 * aguas arriba (`esAdminDePlataforma()` en el layout y en `requireSession()`),
 * y de aquí no sale ningún token: solo el último dígito visible que la UI de
 * Ajustes ya enseña.
 */

export type ResumenTienda = {
  organizationId: string;
  nombre: string;
  slug: string | null;
  creada: Date;
  dueños: { nombre: string; email: string }[];
  personas: number;
  conversaciones: number;
  whatsapp: { numero: string | null; estado: string; verificada: string | null } | null;
  instagram: { usuario: string | null; estado: string } | null;
  messenger: { pagina: string | null; estado: string } | null;
  ia: { proveedor: string; modelo: string; estado: string; ultimo4: string } | null;
  agente: { activo: boolean; nombre: string } | null;
  /** Tienda de UNIKO-RD vinculada; null si el bot de este espacio no tiene catálogo. */
  unikoStoreId: string | null;
};

export async function listarTiendas(): Promise<ResumenTienda[]> {
  const db = getDb();
  const orgs = await db
    .select()
    .from(schema.organization)
    .orderBy(asc(schema.organization.createdAt));
  if (orgs.length === 0) return [];
  const ids = orgs.map((o) => o.id);

  const [miembros, conversaciones, whatsapp, instagram, messenger, ia, agente] =
    await Promise.all([
      db
        .select({
          organizationId: schema.member.organizationId,
          role: schema.member.role,
          nombre: schema.user.name,
          email: schema.user.email,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(inArray(schema.member.organizationId, ids)),
      db
        .select({
          organizationId: schema.conversation.organizationId,
          total: sql<number>`count(*)::int`,
        })
        .from(schema.conversation)
        .where(
          and(
            inArray(schema.conversation.organizationId, ids),
            eq(schema.conversation.isTest, false)
          )
        )
        .groupBy(schema.conversation.organizationId),
      db
        .select({
          organizationId: schema.metaCredentials.organizationId,
          numero: schema.metaCredentials.displayPhoneNumber,
          estado: schema.metaCredentials.status,
          verificada: schema.metaCredentials.verifiedName,
        })
        .from(schema.metaCredentials)
        .where(inArray(schema.metaCredentials.organizationId, ids)),
      db
        .select({
          organizationId: schema.instagramCredentials.organizationId,
          usuario: schema.instagramCredentials.username,
          estado: schema.instagramCredentials.status,
        })
        .from(schema.instagramCredentials)
        .where(inArray(schema.instagramCredentials.organizationId, ids)),
      db
        .select({
          organizationId: schema.messengerCredentials.organizationId,
          pagina: schema.messengerCredentials.pageName,
          estado: schema.messengerCredentials.status,
        })
        .from(schema.messengerCredentials)
        .where(inArray(schema.messengerCredentials.organizationId, ids)),
      db
        .select({
          organizationId: schema.aiCredentials.organizationId,
          proveedor: schema.aiCredentials.provider,
          modelo: schema.aiCredentials.model,
          estado: schema.aiCredentials.status,
          ultimo4: schema.aiCredentials.tokenLast4,
        })
        .from(schema.aiCredentials)
        .where(inArray(schema.aiCredentials.organizationId, ids)),
      db
        .select({
          organizationId: schema.agentProfile.organizationId,
          activo: schema.agentProfile.enabled,
          nombre: schema.agentProfile.name,
        })
        .from(schema.agentProfile)
        .where(inArray(schema.agentProfile.organizationId, ids)),
    ]);

  const porOrg = <T>(filas: { organizationId: string }[]): Map<string, T> =>
    new Map(filas.map((f) => [f.organizationId, f as T]));

  const wa = porOrg<NonNullable<(typeof whatsapp)[number]>>(whatsapp);
  const ig = porOrg<NonNullable<(typeof instagram)[number]>>(instagram);
  const ms = porOrg<NonNullable<(typeof messenger)[number]>>(messenger);
  const iaPor = porOrg<NonNullable<(typeof ia)[number]>>(ia);
  const ag = porOrg<NonNullable<(typeof agente)[number]>>(agente);
  const contadas = porOrg<{ total: number }>(conversaciones);
  const delOrg = new Map<string, { nombre: string; email: string }[]>();
  const personas = new Map<string, number>();
  for (const m of miembros) {
    personas.set(m.organizationId, (personas.get(m.organizationId) ?? 0) + 1);
    if (m.role === "owner") {
      delOrg.set(m.organizationId, [
        ...(delOrg.get(m.organizationId) ?? []),
        { nombre: m.nombre, email: m.email },
      ]);
    }
  }

  return orgs.map((o) => ({
    organizationId: o.id,
    nombre: o.name,
    slug: o.slug,
    creada: o.createdAt,
    dueños: delOrg.get(o.id) ?? [],
    personas: personas.get(o.id) ?? 0,
    conversaciones: contadas.get(o.id)?.total ?? 0,
    whatsapp: wa.has(o.id)
      ? {
          numero: wa.get(o.id)!.numero,
          estado: wa.get(o.id)!.estado,
          verificada: wa.get(o.id)!.verificada,
        }
      : null,
    instagram: ig.has(o.id)
      ? { usuario: ig.get(o.id)!.usuario, estado: ig.get(o.id)!.estado }
      : null,
    messenger: ms.has(o.id)
      ? { pagina: ms.get(o.id)!.pagina, estado: ms.get(o.id)!.estado }
      : null,
    ia: iaPor.has(o.id)
      ? {
          proveedor: iaPor.get(o.id)!.proveedor,
          modelo: iaPor.get(o.id)!.modelo,
          estado: iaPor.get(o.id)!.estado,
          ultimo4: iaPor.get(o.id)!.ultimo4,
        }
      : null,
    agente: ag.has(o.id)
      ? { activo: ag.get(o.id)!.activo, nombre: ag.get(o.id)!.nombre }
      : null,
    unikoStoreId: o.unikoStoreId,
  }));
}

export type ResumenUsuario = {
  userId: string;
  nombre: string;
  email: string;
  creado: Date;
  verificado: boolean;
  tiendas: { organizationId: string; nombre: string; role: string }[];
  admin: boolean;
};

/** Todas las cuentas de la instancia con las tiendas a las que pertenecen. */
export async function listarUsuarios(): Promise<ResumenUsuario[]> {
  const db = getDb();
  const [usuarios, miembros, orgs] = await Promise.all([
    db.select().from(schema.user).orderBy(asc(schema.user.createdAt)),
    db
      .select({
        userId: schema.member.userId,
        organizationId: schema.member.organizationId,
        role: schema.member.role,
      })
      .from(schema.member),
    db.select({ id: schema.organization.id, nombre: schema.organization.name }).from(schema.organization),
  ]);
  const nombres = new Map(orgs.map((o) => [o.id, o.nombre]));
  const deUsuario = new Map<string, { organizationId: string; nombre: string; role: string }[]>();
  for (const m of miembros) {
    deUsuario.set(m.userId, [
      ...(deUsuario.get(m.userId) ?? []),
      {
        organizationId: m.organizationId,
        nombre: nombres.get(m.organizationId) ?? m.organizationId,
        role: m.role,
      },
    ]);
  }
  return usuarios.map((u) => ({
    userId: u.id,
    nombre: u.name,
    email: u.email,
    creado: u.createdAt,
    verificado: u.emailVerified,
    tiendas: deUsuario.get(u.id) ?? [],
    admin: esAdminDePlataforma(u.email),
  }));
}
