import { z } from "zod";
import { apiError, parseBody, withPanel } from "@/lib/api";
import { CorreoEnUso, crearTienda } from "@/server/platform/tiendas";

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
