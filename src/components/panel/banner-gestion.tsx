"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, ShieldCheck } from "lucide-react";

/**
 * La franja que avisa de que lo que se está viendo NO es la tienda del usuario:
 * es otra, en modo gestión. No se puede descartar — si se pudiera cerrar, se
 * cerraría y alguien escribiría en el bot equivocado.
 */
export function BannerGestion({
  nombre,
  organizationId,
}: {
  nombre: string;
  organizationId: string;
}) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    await fetch("/api/panel/gestion", { method: "DELETE" }).catch(() => null);
    router.push("/panel");
    router.refresh();
  }

  return (
    <div
      role="status"
      data-gestion={organizationId}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-info-soft bg-info-tint px-4 py-2 text-[12px] text-info-text"
    >
      <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 font-medium">
        Gestionando <span className="underline">{nombre}</span> — no es tu tienda
      </span>
      <span className="ml-auto flex items-center gap-3">
        <a
          href="/settings/whatsapp"
          className="inline-flex items-center gap-1 underline underline-offset-2"
        >
          <Link2 className="h-3.5 w-3.5" /> WhatsApp
        </a>
        <a href="/settings/ai" className="underline underline-offset-2">
          IA
        </a>
        <a href="/settings/messenger" className="underline underline-offset-2">
          Messenger
        </a>
        <button
          type="button"
          onClick={salir}
          disabled={saliendo}
          className="rounded-md border border-info-soft px-2 py-1 font-medium hover:bg-accent disabled:opacity-60"
        >
          {saliendo ? "Saliendo…" : "Salir de la gestión"}
        </button>
      </span>
    </div>
  );
}
