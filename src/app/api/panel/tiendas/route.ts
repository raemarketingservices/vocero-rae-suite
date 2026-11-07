import { z } from "zod";
import { apiError, parseBody, withPanel } from "@/lib/api";
import { cookies } from "next/headers";
import { COOKIE_GESTION } from "@/lib/auth/platform";
import {
  CorreoEnUso,
  TiendaPropia,
  crearTienda,
  eliminarTienda,
} from "@/server/platform/tiendas";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  nombre: z.string().trim().min(2, "Dale un nombre a la tienda"),
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  // Opcional: sin ella se genera una fuerte. Ocho caracteres es el mínimo que
  // exige Better Auth, así que un `min` más corto sería un 500 con cara de 422.
  password: z.string().min(8, "La contraseña inicial necesita 8 caracteres").optional(),
});

/**
 * Dar de alta la tienda de un cliente desde el panel.
 *
 * Existe porque `ALLOW_SIGNUP=false` cierra el registro público: en el modelo
 * en que RAE vende la suite, el espacio del cliente lo abre RAE. La respuesta
 * devuelve la contraseña inicial una sola vez —es lo que se le manda al
 * cliente—, y nada de esto toca la lista de `PLATFORM_ADMIN_EMAILS`: el cliente
 * nuevo es `owner` de su organización y no ve el panel.
 */
export const POST = withPanel(async (_admin, req: Request) => {
  const parsed = await parseBody(req, cuerpo);
  if (!parsed.ok) return parsed.response;
  try {
    const tienda = await crearTienda(parsed.data);
    return Response.json(tienda, { status: 201 });
  } catch (err) {
    if (err instanceof CorreoEnUso) return apiError(422, "email_en_uso", err.message);
    throw err;
  }
});

const baja = z.object({ organizationId: z.string().min(1) });

/** Eliminar una tienda con todos sus datos. Irreversible: la UI pide escribir el nombre. */
export const DELETE = withPanel(async (admin, req: Request) => {
  const parsed = await parseBody(req, baja);
  if (!parsed.ok) return parsed.response;
  const { organizationId } = parsed.data;
  try {
    if (!(await eliminarTienda(organizationId, admin.userId))) {
      return apiError(404, "not_found", "Esa tienda no existe en la instancia");
    }
  } catch (err) {
    if (err instanceof TiendaPropia) return apiError(409, "tienda_propia", err.message);
    throw err;
  }
  // Si el admin estaba gestionando esa tienda, la cookie ya no apunta a nada.
  const jar = await cookies();
  if (jar.get(COOKIE_GESTION)?.value === organizationId) jar.delete(COOKIE_GESTION);
  return Response.json({ ok: true });
});
