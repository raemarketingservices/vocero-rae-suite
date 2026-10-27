import { listarTiendas } from "@/server/platform/resumen";
import { BotonGestion } from "@/components/panel/boton-gestion";

export const dynamic = "force-dynamic";

function Estado({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <span className="whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium">
      <span className="text-text-3">{etiqueta}</span>{" "}
      {valor ?? <span className="text-text-3">sin conectar</span>}
    </span>
  );
}

/**
 * Las tiendas de la instancia, de una ojeada: quién es el dueño, cuánta gente
 * y conversaciones tiene, y qué canales funcionan. Desde aquí se entra a
 * configurar el bot de cualquiera de ellas.
 */
export default async function PanelTiendasPage() {
  const tiendas = await listarTiendas();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-lg font-semibold text-foreground">
        Tiendas <span className="text-text-3">({tiendas.length})</span>
      </h1>
      <p className="mt-1 text-[13px] text-text-2">
        Entrar a gestionar abre la app de esa tienda con sus propios ajustes. El cliente no te ve
        en su equipo: sales arriba, en la franja de gestión, y vuelves al panel con el botón.
      </p>

      {tiendas.length === 0 ? (
        <p className="mt-8 text-sm text-text-2">Todavía no hay tiendas registradas.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-subtle text-[11px] uppercase text-text-3">
              <tr>
                <th className="px-3 py-2 font-semibold">Tienda</th>
                <th className="px-3 py-2 font-semibold">Dueño</th>
                <th className="px-3 py-2 font-semibold">Equipo</th>
                <th className="px-3 py-2 font-semibold">Conversaciones</th>
                <th className="px-3 py-2 font-semibold">Canales</th>
                <th className="px-3 py-2 font-semibold">Agente / IA</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {tiendas.map((t) => (
                <tr key={t.organizationId} className="border-t align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-foreground">{t.nombre}</div>
                    <div className="text-[11px] text-text-3">
                      {t.slug} · desde {t.creada.toLocaleDateString("es-DO")}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {t.dueños.length === 0 ? (
                      <span className="text-text-3">sin dueño</span>
                    ) : (
                      t.dueños.map((d) => (
                        <div key={d.email}>
                          <div>{d.nombre}</div>
                          <div className="text-[11px] text-text-3">{d.email}</div>
                        </div>
                      ))
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{t.personas}</td>
                  <td className="px-3 py-2.5 tabular-nums">{t.conversaciones}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <Estado
                        etiqueta="WA"
                        valor={t.whatsapp ? `${t.whatsapp.numero ?? t.whatsapp.estado}` : null}
                      />
                      <Estado etiqueta="IG" valor={t.instagram ? t.instagram.usuario : null} />
                      <Estado etiqueta="FB" valor={t.messenger ? t.messenger.pagina : null} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <Estado etiqueta="Agente" valor={t.agente ? (t.agente.activo ? "encendido" : "apagado") : null} />
                      <Estado
                        etiqueta="IA"
                        valor={t.ia ? `${t.ia.modelo} · ${t.ia.estado}` : null}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <BotonGestion organizationId={t.organizationId} nombre={t.nombre} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
