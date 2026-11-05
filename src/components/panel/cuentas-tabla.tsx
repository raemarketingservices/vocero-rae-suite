"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  Search,
  UserRound,
  Users,
} from "lucide-react";
import { initials } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { ResumenUsuario } from "@/server/platform/resumen";

/**
 * La lista de cuentas de la instancia.
 *
 * Búsqueda, filtro y paginación van aquí, sobre el listado completo que ya
 * trajo el servidor: son cuentas de negocio, no un feed infinito, y filtrar en
 * el navegador se nota instantáneo.
 */

const POR_PAGINA = 10;

type Rol = "todos" | "admin" | "owner" | "member";

const ROLES: { valor: Rol; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos los roles" },
  { valor: "admin", etiqueta: "Admin de la plataforma" },
  { valor: "owner", etiqueta: "Propietarios" },
  { valor: "member", etiqueta: "Equipo" },
];

function esRol(u: ResumenUsuario, rol: Rol) {
  if (rol === "todos") return true;
  if (rol === "admin") return u.admin;
  return u.tiendas.some((t) => t.role === rol);
}

function Metrica({
  icono: Icono,
  valor,
  etiqueta,
}: {
  icono: typeof Users;
  valor: number;
  etiqueta: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border bg-card px-5 py-4 shadow-sm">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-tint text-brand-text">
        <Icono className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <div className="text-[24px] font-bold leading-none tabular-nums text-foreground">
          {valor}
        </div>
        <div className="mt-1.5 truncate text-[12.5px] text-text-3">{etiqueta}</div>
      </div>
    </div>
  );
}

/** La insignia de un rol: `admin` es de plataforma, el resto es `member.role`. */
function Etiqueta({ texto, fuerte = false }: { texto: string; fuerte?: boolean }) {
  return (
    <span
      className={
        fuerte
          ? "inline-flex items-center rounded-md bg-brand-tint px-2 py-0.5 text-[11.5px] font-semibold text-brand-text"
          : "inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-[11.5px] font-medium text-text-2"
      }
    >
      {texto}
    </span>
  );
}

const ROL_LABEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  member: "Miembro",
};

export function CuentasTabla({ usuarios }: { usuarios: ResumenUsuario[] }) {
  const [buscado, setBuscado] = useState("");
  const [rol, setRol] = useState<Rol>("todos");
  const [pagina, setPagina] = useState(0);

  const visibles = useMemo(() => {
    const q = buscado.trim().toLowerCase();
    return usuarios.filter((u) => {
      if (!esRol(u, rol)) return false;
      if (!q) return true;
      return `${u.nombre} ${u.email}`.toLowerCase().includes(q);
    });
  }, [usuarios, buscado, rol]);

  // Filtrar cambia el conjunto: la página 3 de una búsqueda de dos resultados
  // no existe, así que se vuelve a la primera.
  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const actual = Math.min(pagina, paginas - 1);
  const filaInicio = actual * POR_PAGINA;
  const hoja = visibles.slice(filaInicio, filaInicio + POR_PAGINA);

  const pendientes = usuarios.filter((u) => !u.verificado).length;
  const administradores = usuarios.filter((u) => u.admin).length;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="min-w-0">
        <h1 className="text-[28px] font-bold tracking-tight text-foreground sm:text-[32px]">
          Cuentas
        </h1>
        <p className="mt-1.5 max-w-2xl text-[14px] text-text-2">
          Administra los usuarios y sus accesos a la plataforma: quién es el
          dueño de cada tienda, quién entró y a quién le falta verificar el
          correo.
        </p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metrica icono={Users} valor={usuarios.length} etiqueta="Cuentas registradas" />
        <Metrica icono={UserRound} valor={administradores} etiqueta="Administrador" />
        <Metrica icono={Clock} valor={pendientes} etiqueta="Pendientes de verificar" />
      </div>

      <div className="mt-6 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 max-w-md flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
              aria-hidden
            />
            <Input
              value={buscado}
              onChange={(e) => {
                setBuscado(e.target.value);
                setPagina(0);
              }}
              placeholder="Buscar por nombre o correo"
              aria-label="Buscar por nombre o correo"
              className="pl-9"
            />
          </div>
          <div className="relative">
            <Filter
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
              aria-hidden
            />
            <select
              value={rol}
              onChange={(e) => {
                setRol(e.target.value as Rol);
                setPagina(0);
              }}
              aria-label="Filtrar por rol"
              className="h-10 appearance-none rounded-md border border-input bg-card pl-9 pr-8 text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ROLES.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.etiqueta}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="text-[12.5px] text-brand-text">
                <th className="rounded-l-lg bg-brand-tint px-4 py-3 font-bold">Usuario</th>
                <th className="bg-brand-tint px-4 py-3 font-bold">Correo electrónico</th>
                <th className="bg-brand-tint px-4 py-3 font-bold">Tienda y rol</th>
                <th className="bg-brand-tint px-4 py-3 font-bold">Estado</th>
                <th className="bg-brand-tint px-4 py-3 font-bold">Fecha de alta</th>
              </tr>
            </thead>
            <tbody>
              {hoja.map((u) => (
                <tr key={u.userId} className="border-t align-middle">
                  <td className="px-4 py-3.5">
                    <span className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[12px] font-bold text-brand-text">
                        {initials(u.nombre)}
                      </span>
                      <span className="min-w-0 font-semibold text-foreground">
                        {u.nombre}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-text-2">{u.email}</td>
                  <td className="px-4 py-3.5">
                    {u.tiendas.length === 0 ? (
                      <span className="text-text-3">ninguna</span>
                    ) : (
                      <span className="flex flex-col gap-1.5">
                        {u.tiendas.map((t) => (
                          <span key={t.organizationId} className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/panel/tiendas/${t.organizationId}`}
                              className="rounded-md text-foreground hover:text-brand-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {t.nombre}
                            </Link>
                            <Etiqueta
                              texto={ROL_LABEL[t.role] ?? t.role}
                              fuerte={t.role === "admin" || (u.admin && t.role === "owner")}
                            />
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {u.verificado ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-tint px-2.5 py-1 text-[11.5px] font-semibold text-success-text">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                        Verificado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-tint px-2.5 py-1 text-[11.5px] font-semibold text-warning-text">
                        <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
                        Pendiente
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-text-2">
                    {u.creado.toLocaleDateString("es-DO")}
                  </td>
                </tr>
              ))}
              {hoja.length === 0 && (
                <tr className="border-t">
                  <td colSpan={5} className="px-4 py-8 text-center text-text-3">
                    Ninguna cuenta coincide con la búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-[12.5px] text-text-3">
            {visibles.length === 0
              ? "Sin resultados"
              : `Mostrando ${filaInicio + 1}–${Math.min(
                  filaInicio + POR_PAGINA,
                  visibles.length
                )} de ${visibles.length} cuentas`}
          </p>
          {paginas > 1 && (
            <span className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setPagina(Math.max(0, actual - 1))}
                disabled={actual === 0}
                aria-label="Página anterior"
                className="rounded-md border p-1.5 text-text-2 hover:bg-accent disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="rounded-md bg-brand px-2.5 py-1 text-[12.5px] font-bold tabular-nums text-brand-fg">
                {actual + 1}
              </span>
              <button
                onClick={() => setPagina(Math.min(paginas - 1, actual + 1))}
                disabled={actual >= paginas - 1}
                aria-label="Página siguiente"
                className="rounded-md border p-1.5 text-text-2 hover:bg-accent disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </span>
          )}
        </div>
      </div>

      {pendientes > 0 && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-text-3">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          La verificación del correo está pendiente en {pendientes}{" "}
          {pendientes === 1 ? "cuenta" : "cuentas"}.
        </p>
      )}
    </div>
  );
}
