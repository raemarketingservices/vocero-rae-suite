"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronsUpDown,
  HelpCircle,
  Palette,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { initials } from "@/lib/utils";
import { BrandLogo, type BrandingMark } from "@/components/brand-mark";
import { PlatformSalida } from "@/components/panel/platform-salida";

/**
 * Cascarón del panel de la plataforma.
 *
 * Barra lateral CLARA y con la marca de la PLATAFORMA, no la de una tienda:
 * esto es la consola de RAE y lo que se ve aquí es lo que el admin edita en
 * `/panel/marca`. El CRM de un cliente sigue con su barra azul marino
 * (`.nav-dark`) y su propia marca: las dos superficies ya no se parecen en
 * nada porque no miran lo mismo.
 *
 * Es cliente por una sola razón — `usePathname()`, para saber qué renglón está
 * activo y cómo se llama el migajón — y el layout lo monta una vez para todas
 * las páginas del panel.
 */
type Entrada = { href: string; label: string; icon: LucideIcon };

function claseItem(activo: boolean) {
  return [
    "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    activo
      ? "bg-brand-tint text-brand-text"
      : "text-text-2 hover:bg-accent hover:text-foreground",
  ].join(" ");
}

export function PanelShell({
  children,
  nombre,
  email,
  marca,
  citas,
}: Readonly<{
  children: React.ReactNode;
  /** Quien entra: el chip de abajo de la barra. */
  nombre: string;
  email: string;
  /** La marca de la plataforma, la única que se pinta aquí. */
  marca: BrandingMark;
  /** Lo decide el servidor leyendo `AGENDA`: sin agenda, la entrada no existe. */
  citas: boolean;
}>) {
  const pathname = usePathname();
  const tiendas: Entrada = { href: "/panel", label: "Tiendas", icon: Building2 };
  const items: Entrada[] = [
    tiendas,
    { href: "/panel/cuentas", label: "Cuentas", icon: Users },
    ...(citas ? [{ href: "/bookings", label: "Citas", icon: CalendarDays }] : []),
    { href: "/panel/marca", label: "Marca", icon: Palette },
  ];
  // "Tiendas" es activa también en el detalle de una tienda (`/panel/tiendas/…`),
  // que es una subpágina suya y no una sección nueva.
  const activa = (href: string) =>
    href === "/panel"
      ? pathname === "/panel" || pathname.startsWith("/panel/tiendas")
      : pathname.startsWith(href);
  const actual = items.find((e) => activa(e.href)) ?? tiendas;

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="hidden w-[248px] shrink-0 flex-col border-r bg-card px-3 pb-3 pt-5 lg:flex">
        <Link
          href="/panel"
          className="px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${marca.name} — panel`}
        >
          <BrandLogo branding={marca} multiline />
        </Link>

        {/* El "cambiador de espacio" del mockup: aquí no hay varios espacios
            que elegir, hay uno solo del que se sale. Es el enlace a MI tienda. */}
        <div className="mt-6">
          <span className="kicker block px-2">Espacio de trabajo</span>
          <Link
            href="/"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[14px] font-bold text-foreground hover:bg-accent"
            title="Salir del panel y entrar a tu propia tienda"
          >
            <span className="min-w-0 flex-1 truncate">{marca.name} CRM</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-text-3" aria-hidden />
          </Link>
        </div>

        <nav className="mt-3 flex flex-col gap-0.5" aria-label="Panel">
          {items.map((e) => {
            const activo = activa(e.href);
            return (
              <Link
                key={e.href}
                href={e.href}
                className={claseItem(activo)}
                aria-current={activo ? "page" : undefined}
              >
                <e.icon
                  className={`h-5 w-5 shrink-0 ${activo ? "text-brand" : "text-text-3"}`}
                  strokeWidth={1.8}
                  aria-hidden
                />
                {e.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="mt-4 flex flex-col gap-0.5 border-t pt-3">
          <Link href="/settings" className={claseItem(false)}>
            <Settings className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
            Configuración
          </Link>
          <Link href="/onboarding" className={claseItem(false)} title="Guía de inicio">
            <HelpCircle className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
            Ayuda
          </Link>
        </div>

        <div className="mt-2 flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-brand-fg">
            {initials(nombre)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-foreground">
              {nombre}
            </span>
            <span className="block truncate text-[11px] text-text-3">{email}</span>
          </span>
          <PlatformSalida />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-4 sm:px-6">
          {/* En el teléfono la barra no existe: el migajón es lo que dice dónde
              se está, así que se queda. */}
          <nav className="flex min-w-0 items-center gap-2 text-[13px]" aria-label="Migajón">
            <Link href="/panel" className="shrink-0 text-text-3 hover:text-foreground">
              Panel
            </Link>
            <span aria-hidden className="text-text-4">
              /
            </span>
            <span className="truncate font-semibold text-brand-text">{actual.label}</span>
          </nav>
          <Link
            href="/inbox"
            className="ml-auto rounded-lg p-2 text-text-3 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Bandeja de tu tienda"
            aria-label="Bandeja"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </Link>
        </header>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
