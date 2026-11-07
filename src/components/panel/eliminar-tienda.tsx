"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Baja definitiva de una tienda. Es irreversible, así que se confirma
 * escribiendo el nombre exacto: un clic distraído no borra a un cliente.
 */
export function EliminarTienda({
  organizationId,
  nombre,
}: {
  organizationId: string;
  nombre: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function eliminar() {
    const escrito = window.prompt(
      `Esto borra «${nombre}» con TODOS sus datos (conversaciones, contactos, conexiones) y las cuentas que no tengan otra tienda. No se puede deshacer.\n\nEscribe el nombre de la tienda para confirmar:`
    );
    if (escrito === null) return;
    if (escrito.trim() !== nombre.trim()) {
      setError("El nombre no coincide: no se eliminó nada.");
      return;
    }
    setOcupado(true);
    setError("");
    const res = await fetch("/api/panel/tiendas", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo eliminar la tienda.");
      setOcupado(false);
      return;
    }
    router.push("/panel");
    router.refresh();
  }

  return (
    <div>
      <Button variant="destructive" onClick={() => void eliminar()} disabled={ocupado}>
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        {ocupado ? "Eliminando…" : "Eliminar tienda"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
