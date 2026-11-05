import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { listarTiendas, type ResumenTienda } from "@/server/platform/resumen";
import { BotonGestion } from "@/components/panel/boton-gestion";

export const dynamic = "force-dynamic";

/**
 * El detalle de UNA tienda, para monitorearla sin entrar a gestionarla.
 *
 * La tarjeta del tablero enseña lo que cabe en un vistazo; aquí está el resto:
 * el número conectado, si la verificación de Meta llegó, qué modelo contesta,
 * en qué estado está la credencial y quién más tiene acceso. Es la pantalla
 * que responde a «esta tienda no contesta, ¿qué le pasa?» sin escribir la
 * cookie de gestión y sin abrir cinco pestañas.
 *
 * No muestra ninguna llave: `aiCredentials` guarda el token cifrado y de aquí
 * solo sale el proveedor y el modelo, que es lo que se mira.
 */

function Estado({ valor, ok }: { valor: string; ok: boolean }) {
  return (
    <span
      className={
        ok
          ? "inline-flex items-center rounded-full bg-success-tint px-2.5 py-1 text-[11.5px] font-semibold text-success-text"
          : "inline-flex items-center rounded-full bg-warning-tint px-2.5 py-1 text-[11.5px] font-semibold text-warning-text"
      }
    >
      {valor}
    </span>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t py-2.5 first:border-t-0 first:pt-0">
      <span className="text-[12.5px] text-text-3">{etiqueta}</span>
      <span className="min-w-0 text-right text-[13px] font-medium text-foreground">
        {valor}
      </span>
    </div>
  );
}

function Bloque({
  titulo,
  children,
}: Readonly<{ titulo: string; children: React.ReactNode }>) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-[14px] font-bold text-foreground">{titulo}</h2>
      {children}
    </section>
  );
}

const ESTADO_LABEL: Record<string, string> = {
  connected: "Conectado",
  reconnect_required: "Reconectar",
  error: "Con error",
  revoked: "Revocado",
  pending: "Pendiente",
};

function estadoCel(estado: string) {
  const texto = ESTADO_LABEL[estado] ?? estado;
  return <Estado valor={texto} ok={estado === "connected"} />;
}

function Numero({ valor }: { valor: string | null }) {
  return valor ? (
    <span className="font-mono text-[12.5px]">{valor}</span>
  ) : (
    <span className="text-text-3">sin número</span>
  );
}

function Detalle({ t }: { t: ResumenTienda }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <Link
        href="/panel"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Volver a Tiendas
      </Link>

      <header className="mt-3 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-bold tracking-tight text-foreground">
            {t.nombre}
          </h1>
          <p className="mt-1 text-[13px] text-text-3">
            Alta el {t.creada.toLocaleDateString("es-DO")}
            {t.slug ? ` · ${t.slug}` : ""}
          </p>
        </div>
        <BotonGestion organizationId={t.organizationId} nombre={t.nombre} etiqueta="Gestionar tienda" />
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Bloque titulo="Actividad">
          <Fila etiqueta="Personas" valor={t.personas} />
          <Fila etiqueta="Conversaciones" valor={t.conversaciones} />
          <Fila
            etiqueta="Dueños"
            valor={t.dueños.length ? t.dueños.map((d) => d.nombre || d.email).join(", ") : "sin dueño"}
          />
        </Bloque>

        <Bloque titulo="Agente de IA">
          <Fila
            etiqueta="Estado"
            valor={
              !t.agente ? (
                <span className="text-text-3">sin configurar</span>
              ) : (
                <Estado valor={t.agente.activo ? "Activo" : "Inactivo"} ok={t.agente.activo} />
              )
            }
          />
          <Fila etiqueta="Nombre" valor={t.agente?.nombre ?? "—"} />
          <Fila
            etiqueta="Proveedor"
            valor={t.ia ? `${t.ia.proveedor} · ${t.ia.modelo}` : "sin credencial (usa el entorno)"}
          />
          <Fila etiqueta="Credencial" valor={t.ia ? estadoCel(t.ia.estado) : "—"} />
        </Bloque>

        <Bloque titulo="Canales">
          <Fila
            etiqueta="WhatsApp"
            valor={
              t.whatsapp ? (
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <Numero valor={t.whatsapp.numero} />
                  {estadoCel(t.whatsapp.estado)}
                </span>
              ) : (
                <span className="text-text-3">sin conectar</span>
              )
            }
          />
          <Fila
            etiqueta="Verificación de Meta"
            valor={t.whatsapp?.verificada ?? <span className="text-text-3">sin nombre verificado</span>}
          />
          <Fila
            etiqueta="Instagram"
            valor={
              t.instagram ? (
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-[12.5px]">{t.instagram.usuario ?? "—"}</span>
                  {estadoCel(t.instagram.estado)}
                </span>
              ) : (
                <span className="text-text-3">sin conectar</span>
              )
            }
          />
          <Fila
            etiqueta="Facebook / Messenger"
            valor={
              t.messenger ? (
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-[12.5px]">{t.messenger.pagina ?? "—"}</span>
                  {estadoCel(t.messenger.estado)}
                </span>
              ) : (
                <span className="text-text-3">sin conectar</span>
              )
            }
          />
        </Bloque>

        <Bloque titulo="Catálogo de UNIKO-RD">
          <Fila
            etiqueta="Tienda vinculada"
            valor={
              t.unikoStoreId ? (
                <span className="font-mono text-[12.5px]">{t.unikoStoreId}</span>
              ) : (
                <span className="text-text-3">sin vincular: el bot no pregunta existencias</span>
              )
            }
          />
          <p className="mt-3 text-[12px] text-text-3">
            Para cambiarla, usa la fila «Catálogo UNIKO» de la tarjeta en el
            tablero, o entra a gestionar la tienda.
          </p>
        </Bloque>
      </div>

      <p className="mt-6 text-[13px] text-text-3">
        Las cuentas de esta tienda, con su rol:{" "}
        <Link href="/panel/cuentas" className="font-semibold text-brand-text hover:underline">
          Panel → Cuentas
        </Link>
        .
      </p>
    </div>
  );
}

export default async function PanelTiendaDetallePage({
  params,
}: Readonly<{ params: Promise<{ organizationId: string }> }>) {
  const { organizationId } = await params;
  const tiendas = await listarTiendas();
  const t = tiendas.find((x) => x.organizationId === organizationId);
  if (!t) notFound();
  return <Detalle t={t} />;
}
