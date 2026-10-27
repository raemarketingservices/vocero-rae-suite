import { z } from "zod";
import {
  hayAdminDePlataforma,
  sesionEsAdminPlataforma,
} from "@/lib/auth/platform";
import { requireSession, UnauthorizedError, type SessionContext } from "@/lib/auth/session";

/** Respuesta de error estándar de la API interna (contrato api.md). */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Envuelve un route handler autenticado: resuelve la sesión (401 si no hay),
 * captura errores no controlados (500 sin stack) y deja pasar Response.
 */
export function withAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: SessionContext;
    try {
      session = await requireSession();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      throw err;
    }
    try {
      return await handler(session, ...args);
    } catch (err) {
      console.error("[api] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/**
 * Envuelve una ruta del panel de la plataforma.
 *
 * Sin `PLATFORM_ADMIN_EMAILS`, o sin que quien llama esté en la lista, la
 * superficie responde 404 y no 403: para una instancia que no tiene admin de
 * plataforma, ese endpoint simplemente no existe (misma regla que `AGENDA`,
 * `CHANNELS` y `ATRIBUCION`).
 */
export function withPanel<Args extends unknown[]>(
  handler: (
    admin: { userId: string; email: string },
    ...args: Args
  ) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let admin: { userId: string; email: string } | null = null;
    try {
      if (hayAdminDePlataforma()) admin = await sesionEsAdminPlataforma();
    } catch (err) {
      console.error("[panel] error resolviendo la sesión:", err);
    }
    if (!admin) return new Response(null, { status: 404 });
    try {
      return await handler(admin, ...args);
    } catch (err) {
      console.error("[panel] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/** Parsea el body JSON con un esquema Zod; inválido → Response 422. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}
