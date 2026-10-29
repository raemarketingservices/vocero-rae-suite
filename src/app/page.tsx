import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { guideFirst } from "@/server/onboarding/guide";

export const dynamic = "force-dynamic";

/**
 * La raíz decide a dónde se entra (issue #86): mientras falte un paso de la
 * guía de inicio o el agente siga apagado, a `/onboarding`; con todo listo,
 * a la Bandeja como siempre. Sin sesión, `/inbox` manda al login.
 *
 * El admin de la plataforma entra a su propia tienda, como cualquiera. Antes
 * caía en `/panel`, pero eso convertía el CRM en algo que solo ven los
 * clientes y dejaba muerto el enlace «Mi tienda» de la cabecera del panel. El
 * panel sigue a un clic: es un grupo más del menú lateral (`nav.ts`), y lo ve
 * quien está en `PLATFORM_ADMIN_EMAILS`.
 */
export default async function Home() {
  const session = await getSessionOrNull();
  if (!session) redirect("/inbox");
  // En modo gestión sí va a la Bandeja: ahí es donde se configura la tienda
  // que eligió, y la franja de arriba le recuerda de cuál se trata.
  if (session.gestion) redirect("/inbox");
  if (await guideFirst(session)) redirect("/onboarding");
  redirect("/inbox");
}
