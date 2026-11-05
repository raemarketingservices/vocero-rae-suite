"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Botón de entrar a gestionar una tienda. Escribe la cookie por la API del
 * panel y mete al admin dentro de la app de esa organización; el botón de
 * salir está en la franja de arriba, no aquí, para que no se pueda quedar
 * nadie "dentro" de una tienda ajena sin verlo.
 *
 * `ancho` y `etiqueta` son para la tarjeta del tablero, que lo usa como acción
 * principal ("Gestionar tienda") y no como el suelto chiquito de la fila.
 */
export function BotonGestion({
  organizationId,
  nombre,
  ancho = false,
  etiqueta,
}: {
  organizationId: string;
  nombre: string;
  ancho?: boolean;
  etiqueta?: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function entrar() {
    setOcupado(true);
    const res = await fetch("/api/panel/gestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    }).catch(() => null);
    if (!res?.ok) {
      setOcupado(false);
      return;
    }
    router.push("/inbox");
    // `refresh` y no solo `push`: el layout de la app pinta la marca con la
    // cookie que ACABA de escribirse, y sin revalidar se quedaría con la del
    // panel (la de la plataforma).
    router.refresh();
  }

  return (
    <Button
      size={ancho ? "default" : "sm"}
      variant="outline"
      className={ancho ? "w-full" : undefined}
      onClick={entrar}
      disabled={ocupado}
    >
      {ocupado ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <LogIn className="h-4 w-4" />
      )}
      <span className="sr-only">Gestionar {nombre}</span>
      <span aria-hidden>{etiqueta ?? (ocupado ? "Entrando…" : "Gestionar")}</span>
    </Button>
  );
}
