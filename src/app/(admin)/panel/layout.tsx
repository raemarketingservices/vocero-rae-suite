import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { hayAdminDePlataforma, sesionEsAdminPlataforma } from "@/lib/auth/platform";
import { BrandMark } from "@/components/brand-mark";

/**
 * Cascarón del panel de la plataforma.
 *
 * Doble puerta: si la instancia no declaró admin, `/panel` no existe
 * (`notFound()`, el mismo 404 de las features apagadas); si lo declaró pero
 * quien entra no está en la lista, se le manda a su propia app sin explicarle
 * por qué.
 */
export default async function PanelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!hayAdminDePlataforma()) notFound();
  const admin = await sesionEsAdminPlataforma();
  if (!admin) redirect("/");

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="nav-dark flex shrink-0 items-center gap-3 border-b bg-subtle px-4 py-2.5">
        <BrandMark className="h-7 w-7 shrink-0" />
        <span className="truncate text-sm font-semibold text-foreground">
          {DEFAULT_BRANDING.name} · Panel
        </span>
        <nav className="ml-2 flex items-center gap-1 text-[13px]">
          <Link
            href="/panel"
            className="rounded-md px-2.5 py-1 font-medium text-text-2 hover:bg-accent hover:text-foreground"
          >
            Tiendas
          </Link>
          <Link
            href="/panel/cuentas"
            className="rounded-md px-2.5 py-1 font-medium text-text-2 hover:bg-accent hover:text-foreground"
          >
            Cuentas
          </Link>
        </nav>
        <span className="ml-auto flex items-center gap-3 text-[12px] text-text-3">
          <span className="hidden truncate sm:block">{admin.email}</span>
          <Link href="/" className="underline underline-offset-2">
            Mi tienda
          </Link>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
