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
 */
export function BotonGestion({
  organizationId,
  nombre,
}: {
  organizationId: string;
  nombre: string;
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
    router.refresh();
  }

  return (
    <Button size="sm" variant="outline" onClick={entrar} disabled={ocupado}>
      {ocupado ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <LogIn className="h-4 w-4" />
      )}
      <span className="sr-only">Gestionar {nombre}</span>
      <span aria-hidden>Gestionar</span>
    </Button>
  );
}
