import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

export type Credentials = {
  id: string;
  organizationId: string;
  /** 023: de dónde salen y a dónde van los mensajes de este número. */
  source: "zernio" | "meta";
  wabaId: string | null;
  phoneNumberId: string | null;
  /** Zernio: `account.id` de la cuenta conectada. Meta directo: null. */
  accountRef: string | null;
  /** Secreto HMAC de las entregas de Zernio; null en modo Meta. */
  webhookSecret: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  token: string;
};

type Row = typeof schema.metaCredentials.$inferSelect;

function toCredentials(row: Row): Credentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    accountRef: row.accountRef,
    webhookSecret: row.webhookSecret,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    status: row.status,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
  };
}

/**
 * Si el número de esta organización habla por Zernio. Lo que se decide con
 * esto es qué superficie de Meta existe: plantillas, media descargada por
 * Graph, CAPI y el alta del webhook son cosas de la Cloud API, y en modo
 * Zernio no hay nada que llamar.
 */
export function hablaPorZernio(
  creds: Pick<Credentials, "source"> | null
): boolean {
  return creds?.source === "zernio";
}

/** Resuelve la conexión por phone_number_id (enrutamiento del webhook de Meta). */
export async function getCredentialsByPhoneNumberId(
  phoneNumberId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.phoneNumberId, phoneNumberId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Zernio: el evento trae `account.id`. */
export async function getCredentialsByAccountRef(
  accountRef: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.accountRef, accountRef))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Resuelve la conexión por WABA ID (eventos a nivel WABA, ej. plantillas). */
export async function getCredentialsByWabaId(
  wabaId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.wabaId, wabaId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function getCredentialsByOrg(
  organizationId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveCredentials(input: {
  organizationId: string;
  source?: "zernio" | "meta";
  wabaId?: string | null;
  phoneNumberId?: string | null;
  accountRef?: string | null;
  webhookSecret?: string | null;
  token: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  const values = {
    organizationId: input.organizationId,
    source: input.source ?? "meta",
    wabaId: input.wabaId ?? null,
    phoneNumberId: input.phoneNumberId ?? null,
    accountRef: input.accountRef ?? null,
    webhookSecret: input.webhookSecret ?? null,
    displayPhoneNumber: input.displayPhoneNumber ?? null,
    verifiedName: input.verifiedName ?? null,
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
    status: "connected" as const,
  };
  await db
    .insert(schema.metaCredentials)
    .values({ id: newId("credentials"), ...values })
    .onConflictDoUpdate({
      target: [schema.metaCredentials.organizationId],
      set: { ...values, updatedAt: new Date() },
    });
}

/**
 * Desconectar el número: borra las credenciales cifradas de la organización.
 *
 * No toca conversaciones, contactos ni leads — son de la organización, no de
 * la conexión. Idempotente: sin fila, no hay nada que borrar.
 */
export async function desconectarCanal(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId));
}

/** Marca la conexión como vencida (token inválido detectado en runtime). */
export async function markReconnectRequired(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.metaCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.metaCredentials.organizationId, organizationId));
}

/** Últimos 4 caracteres del token para mostrar en UI (jamás el token). */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
