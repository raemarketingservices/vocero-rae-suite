"use client";

import { useState } from "react";
import { Loader2, Package } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * A qué tienda de UNIKO-RD pertenece este espacio.
 *
 * Con el vínculo, el agente consulta las existencias vivas de ESA tienda en
 * cada turno; sin él, contesta solo con el knowledge base (que es una foto de
 * hace hasta 15 minutos). El id lo pone RAE y no el cliente: uno equivocado
 * haría que el bot dé los precios y el stock de otro negocio.
 *
 * Vive plegado porque es una acción de alta, una vez por tienda.
 */
export function VinculoUniko({
  organizationId,
  storeId,
}: {
  organizationId: string;
  storeId: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(storeId ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(storeIdNuevo: string | null) {
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/panel/vinculo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, storeId: storeIdNuevo }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    if (!res?.ok) {
      setError(data?.error?.message ?? "No se pudo guardar el vínculo");
      setOcupado(false);
      return;
    }
    setOcupado(false);
    setAbierto(false);
    setValor(storeIdNuevo ?? "");
    // La tarjeta de arriba es del servidor: sin esto seguiría con el id viejo.
    router.refresh();
  }

  return (
    <div className="border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-text-3">
          <Package className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Catálogo UNIKO
          {storeId ? (
            <b className="font-mono font-medium text-text-2">{storeId}</b>
          ) : (
            <b className="font-medium">sin vincular</b>
          )}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-expanded={abierto}
          onClick={() => {
            setAbierto((v) => !v);
            setError(null);
          }}
        >
          {storeId ? "Cambiar" : "Vincular"}
        </Button>
      </div>

      {abierto && (
        <div className="mt-2">
          <p className="text-[11.5px] text-text-3">
            El <code>store_id</code> de la tabla <code>stores</code> de UNIKO-RD
            (es un slug, no un UUID). Mientras esté vacío, el bot no pregunta
            existencias y usa solo el knowledge base.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="tech-store-rd"
              className="h-8 max-w-[280px] font-mono text-xs"
              aria-label="store_id de UNIKO-RD"
            />
            <Button
              size="sm"
              disabled={ocupado || valor.trim() === storeId || !valor.trim()}
              onClick={() => guardar(valor.trim())}
            >
              {ocupado ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Guardar"
              )}
            </Button>
            {storeId && (
              <Button
                size="sm"
                variant="outline"
                disabled={ocupado}
                onClick={() => guardar(null)}
              >
                Quitar
              </Button>
            )}
          </div>
          {error && <p className="mt-2 text-[12.5px] text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
