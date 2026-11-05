"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Building2,
  Facebook,
  Filter,
  Instagram,
  MessageSquare,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initials } from "@/lib/utils";
import type { ResumenTienda } from "@/server/platform/resumen";
import { BotonGestion } from "@/components/panel/boton-gestion";
import { NuevaTienda } from "@/components/panel/nueva-tienda";
import { VinculoUniko } from "@/components/panel/vinculo-uniko";

/**
 * El tablero de tiendas del panel.
 *
 * Filtro y búsqueda viven aquí, en el navegador, sobre el listado que ya trajo
 * el servidor: con las tiendas que maneja RAE (decenas, no miles) pedir cada
 * tecleo es una ronda de red para nada, y así el buscador responde al instante.
 */

type Filtro = "todas" | "conectada" | "agente" | "sin_canal";

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas las tiendas" },
  { valor: "conectada", etiqueta: "Con un canal conectado" },
  { valor: "agente", etiqueta: "Con el agente encendido" },
  { valor: "sin_canal", etiqueta: "Sin ningún canal" },
];

function conectado(credencial: { estado: string } | null) {
  return credencial?.estado === "connected";
}

function algunaConectada(t: ResumenTienda) {
  return (
    conectado(t.whatsapp) || conectado(t.instagram) || conectado(t.messenger)
  );
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

function Chip({
  tono,
  texto,
}: {
  tono: "ok" | "mudo" | "aviso";
  texto: string;
}) {
  return (
    <span
      className={
        tono === "ok"
          ? "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-tint px-2.5 py-1 text-[11.5px] font-semibold text-success-text"
          : tono === "aviso"
            ? "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warning-tint px-2.5 py-1 text-[11.5px] font-semibold text-warning-text"
            : "inline-flex shrink-0 items-center rounded-full bg-secondary px-2.5 py-1 text-[11.5px] font-medium text-text-3"
      }
    >
      {tono !== "mudo" && (
        <span
          className={
            tono === "ok"
              ? "h-1.5 w-1.5 rounded-full bg-success"
              : "h-1.5 w-1.5 rounded-full bg-warning"
          }
          aria-hidden
        />
      )}
      {texto}
    </span>
  );
}

function Canal({
  icono: Icono,
  nombre,
  estado,
  tinte,
}: {
  icono: typeof Instagram;
  nombre: string;
  estado: boolean;
  /** El verde de WhatsApp es identidad del canal, no estado: es el único caso
   *  en que un ícono conserva su color de marca. */
  tinte?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <Icono
        className={`h-[18px] w-[18px] shrink-0 ${tinte ?? "text-text-3"}`}
        strokeWidth={1.7}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{nombre}</span>
      <Chip tono={estado ? "ok" : "mudo"} texto={estado ? "Conectado" : "Sin conectar"} />
    </div>
  );
}

function Cuenta({
  icono: Icono,
  nombre,
  valor,
}: {
  icono: typeof Users;
  nombre: string;
  valor: number;
}) {
  return (
    <span className="flex items-center gap-2 text-[12.5px] text-text-3">
      <Icono className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden />
      {nombre} <b className="font-bold tabular-nums text-foreground">{valor}</b>
    </span>
  );
}

function TiendaCard({ t, conCatalogo }: { t: ResumenTienda; conCatalogo: boolean }) {
  const dueño = t.dueños[0];
  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <header className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[14px] font-bold text-brand-text">
          {initials(t.nombre)}
        </span>
        {/* El nombre lleva al detalle: así se monitoriza una tienda sin entrar
            a gestionarla, que escribe la cookie de gestión y cambia de pantalla. */}
        <Link
          href={`/panel/tiendas/${t.organizationId}`}
          className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h2 className="text-[16px] font-bold leading-snug tracking-tight text-foreground hover:text-brand-text">
            {t.nombre}
          </h2>
          <p className="mt-1 truncate text-[11.5px] text-text-4">
            desde {t.creada.toLocaleDateString("es-DO")}
          </p>
        </Link>
      </header>

      <div className="min-w-0">
        <p className="kicker">Propietario</p>
        <p className="mt-1 truncate text-[13.5px] font-semibold text-foreground">
          {dueño?.nombre || "sin dueño"}
        </p>
        {dueño?.email && (
          <p className="truncate text-[12px] text-text-3">{dueño.email}</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5">
        <Cuenta icono={Users} nombre="Personas" valor={t.personas} />
        <span aria-hidden className="h-5 w-px bg-border" />
        <Cuenta icono={MessageSquare} nombre="Conversaciones" valor={t.conversaciones} />
      </div>

      <div>
        <p className="mb-1 text-[13px] font-bold text-foreground">Canales</p>
        <Canal
          icono={MessageSquare}
          nombre="WhatsApp"
          estado={conectado(t.whatsapp)}
          tinte="text-success"
        />
        <Canal icono={Instagram} nombre="Instagram" estado={conectado(t.instagram)} />
        <Canal icono={Facebook} nombre="Facebook" estado={conectado(t.messenger)} />
      </div>

      <div className="flex items-center gap-2.5 border-t pt-3">
        <Bot className="h-[18px] w-[18px] shrink-0 text-text-3" strokeWidth={1.7} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          Agente IA{t.agente?.nombre ? ` · ${t.agente.nombre}` : ""}
        </span>
        <Chip
          tono={!t.agente ? "mudo" : t.agente.activo ? "ok" : "aviso"}
          texto={!t.agente ? "Sin configurar" : t.agente.activo ? "Activo" : "Inactivo"}
        />
      </div>

      {conCatalogo && (
        <VinculoUniko organizationId={t.organizationId} storeId={t.unikoStoreId} />
      )}

      <BotonGestion
        organizationId={t.organizationId}
        nombre={t.nombre}
        ancho
        etiqueta="Gestionar tienda"
      />
    </article>
  );
}

export function TiendasTablero({
  tiendas,
  conCatalogo,
}: {
  tiendas: ResumenTienda[];
  conCatalogo: boolean;
}) {
  const [buscado, setBuscado] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [alta, setAlta] = useState(false);

  const visibles = useMemo(() => {
    const q = buscado.trim().toLowerCase();
    return tiendas.filter((t) => {
      if (filtro === "conectada" && !algunaConectada(t)) return false;
      if (filtro === "agente" && !t.agente?.activo) return false;
      if (filtro === "sin_canal" && algunaConectada(t)) return false;
      if (!q) return true;
      const texto = `${t.nombre} ${t.slug ?? ""} ${t.dueños
        .map((d) => `${d.nombre} ${d.email}`)
        .join(" ")}`.toLowerCase();
      return texto.includes(q);
    });
  }, [tiendas, buscado, filtro]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-bold tracking-tight text-foreground sm:text-[32px]">
            Tiendas
          </h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-text-2">
            Gestiona los negocios y sus conexiones desde un solo lugar. Entrar a
            gestionar abre la app de esa tienda con sus propios ajustes; el
            cliente no te ve en su equipo, sales arriba en la franja de gestión.
          </p>
        </div>
        <Button aria-expanded={alta} onClick={() => setAlta((v) => !v)}>
          <Plus className="h-4 w-4" />
          Crear tienda
        </Button>
      </header>

      <NuevaTienda abierto={alta} />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metrica icono={Building2} valor={tiendas.length} etiqueta="Tiendas registradas" />
        <Metrica
          icono={MessageSquare}
          valor={tiendas.filter(algunaConectada).length}
          etiqueta="Canal conectado"
        />
        <Metrica
          icono={Bot}
          valor={tiendas.filter((t) => t.agente?.activo).length}
          etiqueta="Agente activo"
        />
        <Metrica
          icono={Users}
          valor={tiendas.reduce((n, t) => n + t.conversaciones, 0)}
          etiqueta="Conversaciones"
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
            aria-hidden
          />
          <Input
            value={buscado}
            onChange={(e) => setBuscado(e.target.value)}
            placeholder="Buscar tienda o propietario"
            aria-label="Buscar tienda o propietario"
            className="pl-9"
          />
        </div>
        <div className="relative">
          <Filter
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
            aria-hidden
          />
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as Filtro)}
            aria-label="Filtrar tiendas"
            className="h-10 appearance-none rounded-md border border-input bg-card pl-9 pr-8 text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {FILTROS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tiendas.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed p-6 text-center text-sm text-text-2">
          Todavía no hay tiendas registradas. Crea la primera con el botón de
          arriba, o deja que el cliente se registre en <code>/register</code>.
        </p>
      ) : visibles.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed p-6 text-center text-sm text-text-2">
          Ninguna tienda coincide con la búsqueda.
        </p>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((t) => (
            <TiendaCard key={t.organizationId} t={t} conCatalogo={conCatalogo} />
          ))}
        </div>
      )}
    </div>
  );
}
