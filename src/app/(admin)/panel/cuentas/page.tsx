import { listarUsuarios } from "@/server/platform/resumen";
import { hayAdminDePlataforma } from "@/lib/auth/platform";

export const dynamic = "force-dynamic";

/**
 * Todas las cuentas de la instancia, con las tiendas a las que pertenecen.
 * Es lo que responde a «¿quién hay dado de alta y en qué negocio mete las
 * narices?».
 */
export default async function PanelCuentasPage() {
  const usuarios = await listarUsuarios();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-lg font-semibold text-foreground">
        Cuentas <span className="text-text-3">({usuarios.length})</span>
      </h1>
      <div className="mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-subtle text-[11px] uppercase text-text-3">
            <tr>
              <th className="px-3 py-2 font-semibold">Nombre</th>
              <th className="px-3 py-2 font-semibold">Correo</th>
              <th className="px-3 py-2 font-semibold">Tiendas y rol</th>
              <th className="px-3 py-2 font-semibold">Alta</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.userId} className="border-t">
                <td className="px-3 py-2.5 font-medium text-foreground">
                  {u.nombre}
                  {u.admin && hayAdminDePlataforma() ? (
                    <span className="ml-2 rounded-md bg-info-tint px-1.5 py-0.5 text-[11px] font-medium text-info-text">
                      admin de la plataforma
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  {u.email}
                  {!u.verificado ? (
                    <span className="ml-2 text-[11px] text-text-3">sin verificar</span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  {u.tiendas.length === 0 ? (
                    <span className="text-text-3">ninguna</span>
                  ) : (
                    u.tiendas.map((t) => (
                      <span key={t.organizationId} className="mr-2 whitespace-nowrap">
                        {t.nombre} <span className="text-text-3">({t.role})</span>
                      </span>
                    ))
                  )}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-text-2">
                  {u.creado.toLocaleDateString("es-DO")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
