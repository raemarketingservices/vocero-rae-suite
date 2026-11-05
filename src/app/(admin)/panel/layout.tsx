import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb, schema } from "@/lib/db";
import { hayAdminDePlataforma, sesionEsAdminPlataforma } from "@/lib/auth/platform";
import { agendaEnabled } from "@/server/agenda/flag";
import { getPlatformBranding } from "@/server/platform-branding";
import { PanelShell } from "@/components/panel/panel-shell";

/**
 * Cascarón del panel de la plataforma.
 *
 * Doble puerta: si la instancia no declaró admin, `/panel` no existe
 * (`notFound()`, el mismo 404 de las features apagadas); si lo declaró pero
 * quien entra no está en la lista, se le manda a su propia app sin explicarle
 * por qué.
 *
 * Lo que pinta es la marca de la PLATAFORMA (`platform_brand`), nunca la de una
 * tienda: el panel es la consola de RAE, y verla con la marca del cliente que
 * tocó hace poco sería confundir las dos superficies.
 */
export default async function PanelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!hayAdminDePlataforma()) notFound();
  const admin = await sesionEsAdminPlataforma();
  if (!admin) redirect("/");

  const [marca, fila] = await Promise.all([
    getPlatformBranding(),
    getDb()
      .select({ nombre: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, admin.userId))
      .limit(1),
  ]);

  return (
    <PanelShell
      marca={{ name: marca.name, accent: marca.accent, favicon: marca.favicon }}
      nombre={fila[0]?.nombre ?? admin.email}
      email={admin.email}
      citas={agendaEnabled()}
    >
      {children}
    </PanelShell>
  );
}
