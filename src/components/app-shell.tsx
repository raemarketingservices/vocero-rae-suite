"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import type { Branding } from "@/lib/branding";
import type { ThemePreference } from "@/lib/theme";
import type { ResolvedCommit } from "@/lib/version";
import { AppNav } from "@/components/app-nav";
import { BrandLogo } from "@/components/brand-mark";
import { appNavGroups, isNavActive, SETTINGS_ITEM } from "@/lib/nav";

/**
 * Cascarón de la app en dos modos:
 *
 * - Escritorio (lg+): el panel lateral es una columna fija, como siempre.
 * - Móvil/tableta: el lateral sale de la izquierda como cajón sobre un velo,
 *   y arriba queda una barra azul marino con el hamburguesa y la marca. El
 *   cajón se cierra solo al navegar (el `pathname` cambia) y con Escape.
 *
 * La altura usa `100dvh` (no `100vh`) porque en el navegador móvil la barra de
 * direcciones se encoge al hacer scroll: con `vh` el compositor de la Bandeja
 * queda debajo del borde visible.
 */
export function AppShell({
  branding,
  userName,
  role,
  theme,
  commit,
  agenda = false,
  panel = false,
  aviso = null,
  children,
}: {
  branding: Branding;
  userName: string;
  role: string;
  theme: ThemePreference;
  /** Commit resuelto en el servidor, con su procedencia (ver `resolveCommit`). */
  commit?: ResolvedCommit;
  /** 015 — ¿esta instancia tiene agenda? Lo decide el servidor. */
  agenda?: boolean;
  /** ¿Quien mira es admin de la plataforma? Lo decide el servidor, por correo. */
  panel?: boolean;
  /**
   * Franja de aviso por encima de TODA la aplicación (#85).
   *
   * Va aquí y no dentro de una pantalla porque lo que anuncia no es de una
   * pantalla: es que el agente no puede contestar. Quien tiene ese problema
   * no está mirando Ajustes, está mirando su bandeja y preguntándose por qué
   * no responde nadie.
   */
  aviso?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // Navegar = cerrar el cajón. Sin esto, tocar "Pipeline" deja el velo encima
  // de la pantalla recién cargada.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // Breadcrumb del topbar: la misma entrada que el menú marca como activa.
  const section = [...appNavGroups({ agenda, role, panel }).flatMap((g) => g.items), SETTINGS_ITEM]
    .find((item) => isNavActive(pathname, item.href))?.label;

  return (
    <div className="flex h-dvh overflow-hidden bg-subtle">
      {navOpen && (
        <button
          aria-label="Cerrar el menú"
          tabIndex={-1}
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-overlay lg:hidden"
        />
      )}

      <AppNav
        branding={branding}
        commit={commit}
        userName={userName}
        role={role}
        theme={theme}
        agenda={agenda}
        panel={panel}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar blanco: en el teléfono lleva el hamburguesa y la marca; en
            escritorio, el breadcrumb de la sección. */}
        <header className="flex h-12 shrink-0 items-center gap-1.5 border-b bg-background px-2 text-foreground lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Abrir el menú"
            aria-expanded={navOpen}
            className="rounded-md p-2 text-text-2 hover:bg-accent hover:text-foreground"
          >
            <Menu className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <BrandLogo branding={branding} className="min-w-0" />
        </header>

        <header className="hidden h-16 shrink-0 items-center border-b bg-background px-8 lg:flex">
          <p className="text-[12px] text-text-3">
            Workspace
            {section && (
              <>
                {" / "}
                <b className="font-semibold text-foreground">{section}</b>
              </>
            )}
          </p>
        </header>

        {aviso}

        {/* El contenido flota como tarjeta sobre el gris de la página. */}
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden lg:p-6">
          <div className="h-full min-h-0 overflow-hidden bg-background lg:rounded-[14px] lg:border">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
