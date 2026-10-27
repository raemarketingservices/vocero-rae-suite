import { customAlphabet } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isInternalSignup } from "@/server/auth/internal-signup";

/** Etapas sembradas del pipeline (US2). */
const SEED_STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

const slugSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

/**
 * Slug legible y único por espacio: la plataforma es multi-tenant, así que
 * "principal" fijo chocaría en la segunda organización. El sufijo corto evita
 * además que dos clientes con el mismo nombre compartan slug.
 */
function organizationSlug(userName: string): string {
  const base =
    userName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "negocio";
  return `${base}-${slugSuffix()}`;
}

/**
 * El espacio de un cliente: organización propia, él como propietario, pipeline
 * y perfil del agente sembrados. Es lo que hace que cada tienda tenga su bot de
 * WhatsApp y su base de conocimiento separados del resto.
 *
 * Lo llaman dos caminos: el registro público (por `onUserCreated`, gancho de
 * Better Auth) y el alta desde el panel de la plataforma, que crea la cuenta
 * por dentro —por eso recibe el nombre del negocio en vez de inventarlo a
 * partir del usuario.
 */
export async function crearEspacioCliente(
  userId: string,
  userName: string,
  nombreNegocio?: string
): Promise<string> {
  const db = getDb();
  const orgId = newId("organization");
  const nombre = nombreNegocio?.trim() || (userName ? `Negocio de ${userName}` : "Mi negocio");
  await db.transaction(async (tx) => {
    await tx.insert(schema.organization).values({
      id: orgId,
      name: nombre,
      slug: organizationSlug(nombre),
    });
    await tx.insert(schema.member).values({
      id: newId("member"),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await tx.insert(schema.pipelineStage).values(
      SEED_STAGES.map((s, i) => ({
        id: newId("stage"),
        organizationId: orgId,
        name: s.name,
        position: i,
        kind: s.kind,
      }))
    );
    await tx.insert(schema.agentProfile).values({
      id: newId("agentProfile"),
      organizationId: orgId,
    });
  });
  return orgId;
}

/**
 * Cada registro público crea el espacio del cliente (US-).
 *
 * Las cuentas de equipo (owner → API) NO pasan por aquí: su membresía la
 * inserta explícitamente quien las crea, y crearles un espacio propio las
 * dejaría huérfanas del negocio al que entran.
 */
export async function onUserCreated(userId: string, userName: string) {
  if (isInternalSignup()) return;
  await crearEspacioCliente(userId, userName);
}

/** Organización activa de un usuario (su primera membresía). */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  return (await resolveMembership(userId))?.organizationId ?? null;
}

export async function resolveMembership(
  userId: string
): Promise<{ organizationId: string; role: string } | null> {
  const db = getDb();
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}
