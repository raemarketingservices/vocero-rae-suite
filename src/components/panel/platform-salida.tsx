"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth/client";

/**
 * Cerrar sesión desde el panel. Sale del cascarón claro y no del azul porque
 * en la consola de la plataforma no hay otra puerta: el admin ya está arriba.
 */
export function PlatformSalida() {
  const router = useRouter();

  return (
    <button
      aria-label="Cerrar sesión"
      title="Cerrar sesión"
      className="rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={async () => {
        await signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      <LogOut className="h-4 w-4" strokeWidth={1.7} />
    </button>
  );
}
