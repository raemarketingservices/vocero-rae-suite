import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { guideFirst } from "@/server/onboarding/guide";

export const dynamic = "force-dynamic";

/**
 * La raíz decide a dónde se entra (issue #86): mientras falte un paso de la
 * guía de inicio o el agente siga apagado, a `/onboarding`; con todo listo,
 * a la Bandeja como siempre. Sin sesión, `/inbox` manda al login.
 *
 * El admin de la plataforma es la excepción: no tiene tienda propia que
 * atender, así que su pantalla es el panel. Entrar y verse dentro del bot de
 * un cliente —con la marca y la bandeja de ese cliente— es justo lo que hace
 * creer que el panel no existe.
 */
export default async function Home() {
  const session = await getSessionOrNull();
  if (!session) redirect("/inbox");
  // En modo gestión sí va a la Bandeja: ahí es donde se configura la tienda
  // que eligió, y la franja de arriba le recuerda de cuál se trata.
  if (session.gestion) redirect("/inbox");
  if (session.adminDePlataforma) redirect("/panel");
  if (await guideFirst(session)) redirect("/onboarding");
  redirect("/inbox");
}
