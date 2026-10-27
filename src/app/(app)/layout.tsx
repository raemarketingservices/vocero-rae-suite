import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { esAdminDePlataforma } from "@/lib/auth/platform";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { AppShell } from "@/components/app-shell";
import { resolveCommit } from "@/lib/version";
import { agendaEnabled } from "@/server/agenda/flag";
import { avisoIaDe } from "@/server/ai/aviso";
import { AvisoIaBanner } from "@/components/avisos/aviso-ia";
import { BannerGestion } from "@/components/panel/banner-gestion";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const branding = await getBranding(session.organizationId);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );
  // El agente encendido y sin con qué pensar se ve desde fuera igual que un
  // bot roto. Se resuelve en el servidor y en el layout para que se vea desde
  // CUALQUIER pantalla, no solo desde el panel de un contacto (#85).
  const aviso = await avisoIaDe(session.organizationId);
  // El correo ya está en la sesión consultada arriba: preguntar si manda en
  // toda la plataforma no cuesta otra llamada, y el nav no lee entorno.
  const esAdmin = esAdminDePlataforma(authSession?.user.email);

  return (
    <AppShell
      branding={branding}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
      theme={theme}
      // Se resuelve aquí, en el servidor: el cliente no ve `SOURCE_COMMIT`.
      // Baja con su procedencia, para que la insignia no presente como
      // verificado un commit que no salió del build (#50).
      commit={resolveCommit()}
      // Qué módulos opcionales existen se decide en el servidor y baja por
      // prop, igual que los canales de la Bandeja. El nav es un componente de
      // cliente: no puede —ni debe— leer variables de entorno.
      agenda={agendaEnabled()}
      panel={esAdmin}
      aviso={
        <>
          {/* El orden importa: primero de qué tienda se trata, después si el
              agente de esa tienda puede pensar. */}
          {session.gestion ? (
            <BannerGestion
              nombre={session.gestion.nombre}
              organizationId={session.gestion.organizationId}
            />
          ) : null}
          <AvisoIaBanner aviso={aviso} />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
