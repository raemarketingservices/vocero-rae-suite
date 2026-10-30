import { Building2, MessageSquare, Power, Users } from "lucide-react";
import {
  listarTiendas,
  type ResumenTienda,
} from "@/server/platform/resumen";
import { inventarioUnikoActivo } from "@/server/uniko/config";
import { BotonGestion } from "@/components/panel/boton-gestion";
import { NuevaTienda } from "@/components/panel/nueva-tienda";
import { VinculoUniko } from "@/components/panel/vinculo-uniko";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Las tiendas de la instancia, de una ojeada: quién es el dueño, cuánto se le
 * escribe, y qué canales y agente funcionan. Desde aquí se entra a configurar el
 * bot de cualquiera de ellas.
 *
 * Se pinta por tarjeta y no por tabla: lo que se mira no es un número sino el
 * ESTADO de cada tienda, y en una tabla de siete columnas un `reconnect_required`
 * a las tres tiendas se vuelve un texto más. Cada bicho tiene su color, y las
 * cuatro cifras de arriba cuentan lo que de verdad importa saber sin bajar.
 */

/** Los tres estados de una pieza de la tienda: funciona, falla o no existe. */
type Tonos = "ok" | "aviso" | "mudo";

const PUNTO: Record<Tonos, string> = {
  ok: "bg-success",
  aviso: "bg-warning",
  mudo: "bg-text-3",
};

function Chip({
  etiqueta,
  valor,
  tono,
}: {
  etiqueta: string;
  valor: string | null;
  tono: Tonos;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium",
        tono === "mudo"
          ? "border-dashed text-text-3"
          : tono === "aviso"
            ? "border-warning-soft bg-warning-tint text-warning-text"
            : "border-border-strong text-text-2"
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PUNTO[tono])} />
      <span className="text-text-3">{etiqueta}</span>
      {valor && <span className="truncate">{valor}</span>}
    </span>
  );
}

/** `connected` / `reconnect_required` / `error`, o null si no hay conexión. */
function tonoDeEstado(credencial: { estado: string } | null): Tonos {
  if (!credencial) return "mudo";
  return credencial.estado === "connected" ? "ok" : "aviso";
}

function Metrica({
  icono: Icono,
  valor,
  etiqueta,
}: {
  icono: typeof Building2;
  valor: number;
  etiqueta: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand-text">
        <Icono className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <div className="text-[18px] font-bold leading-none tabular-nums text-foreground">
          {valor}
        </div>
        <div className="mt-1 truncate text-[11.5px] text-text-3">{etiqueta}</div>
      </div>
    </div>
  );
}

function TiendaCard({ t, conCatalogo }: { t: ResumenTienda; conCatalogo: boolean }) {
  const dueños = t.dueños.map((d) => d.nombre || d.email).join(", ");
  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold leading-tight tracking-tight text-foreground">
            {t.nombre}
          </h2>
          <p className="mt-0.5 truncate text-[11.5px] text-text-3">
            {t.slug ?? t.organizationId} · desde{" "}
            {t.creada.toLocaleDateString("es-DO")}
          </p>
        </div>
        <BotonGestion organizationId={t.organizationId} nombre={t.nombre} />
      </header>

      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">
          {dueños || "sin dueño"}
        </p>
        {t.dueños[0]?.email && (
          <p className="truncate text-[11.5px] text-text-3">{t.dueños[0].email}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg bg-subtle px-3 py-2 text-[12.5px]">
        <span className="text-text-3">
          Personas{" "}
          <b className="tabular-nums text-foreground">{t.personas}</b>
        </span>
        <span className="text-right text-text-3">
          Conversaciones{" "}
          <b className="tabular-nums text-foreground">{t.conversaciones}</b>
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Chip
          etiqueta="WA"
          tono={tonoDeEstado(t.whatsapp)}
          valor={
            t.whatsapp
              ? t.whatsapp.numero ??
                (t.whatsapp.estado === "connected" ? "conectado" : "reconectar")
              : null
          }
        />
        <Chip
          etiqueta="IG"
          tono={tonoDeEstado(t.instagram)}
          valor={
            t.instagram
              ? t.instagram.usuario ??
                (t.instagram.estado === "connected" ? "conectado" : "reconectar")
              : null
          }
        />
        <Chip
          etiqueta="FB"
          tono={tonoDeEstado(t.messenger)}
          valor={
            t.messenger
              ? t.messenger.pagina ??
                (t.messenger.estado === "connected" ? "conectado" : "reconectar")
              : null
          }
        />
      </div>

      <div className="flex flex-wrap gap-1.5 border-t pt-3">
        <Chip
          etiqueta="Agente"
          tono={!t.agente ? "mudo" : t.agente.activo ? "ok" : "aviso"}
          valor={t.agente ? (t.agente.activo ? "encendido" : "apagado") : null}
        />
        <Chip
          etiqueta="IA"
          tono={tonoDeEstado(t.ia)}
          valor={t.ia ? `${t.ia.proveedor}/${t.ia.modelo}` : null}
        />
      </div>

      {conCatalogo && (
        <VinculoUniko organizationId={t.organizationId} storeId={t.unikoStoreId} />
      )}
    </article>
  );
}

export default async function PanelTiendasPage() {
  const tiendas = await listarTiendas();
  // Sin URL ni llave anon en el despliegue, la superficie de catálogo no
  // existe: ni la tarjeta se pinta (la ruta también responde 404).
  const conCatalogo = inventarioUnikoActivo();
  const conCanal = tiendas.filter(
    (t) =>
      t.whatsapp?.estado === "connected" ||
      t.instagram?.estado === "connected" ||
      t.messenger?.estado === "connected"
  ).length;
  const conAgente = tiendas.filter((t) => t.agente?.activo).length;
  const conversaciones = tiendas.reduce((n, t) => n + t.conversaciones, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
      <h1 className="text-[22px] font-bold tracking-tight text-foreground">
        Tiendas
      </h1>
      <p className="mt-1 max-w-2xl text-[13px] text-text-2">
        Entrar a gestionar abre la app de esa tienda con sus propios ajustes. El
        cliente no te ve en su equipo: sales arriba, en la franja de gestión, y
        vuelves al panel con el botón.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica icono={Building2} valor={tiendas.length} etiqueta="Tiendas en la instancia" />
        <Metrica icono={MessageSquare} valor={conCanal} etiqueta="Con un canal conectado" />
        <Metrica icono={Power} valor={conAgente} etiqueta="Con el agente encendido" />
        <Metrica icono={Users} valor={conversaciones} etiqueta="Conversaciones entre todas" />
      </div>

      <div className="mt-6">
        <NuevaTienda />
      </div>

      {tiendas.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed p-6 text-center text-sm text-text-2">
          Todavía no hay tiendas registradas. Crea la primera arriba, o deja que
          el cliente se registre en <code>/register</code>.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tiendas.map((t) => (
            <TiendaCard key={t.organizationId} t={t} conCatalogo={conCatalogo} />
          ))}
        </div>
      )}
    </div>
  );
}
