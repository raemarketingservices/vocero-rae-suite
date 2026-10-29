"use client";

import { useState } from "react";
import { KeyRound, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BotonGestion } from "@/components/panel/boton-gestion";

type Creada = { organizationId: string; nombre: string; email: string; password: string };

/**
 * Alta manual de una tienda, con la contraseña inicial en la mano.
 *
 * La contraseña se enseña UNA vez: es el dato que se le manda al
 * cliente, y el CRM no la guarda en ningún lado legible (el hash lo genera
 * Better Auth). Si se pierde, se cambia desde el panel de Equipo de esa tienda
 * o se le manda a recuperar por correo.
 *
 * El formulario está plegado detrás del botón: es una acción rara (el cliente
 * se autoregistra) y abierto ocupaba media pantalla de tiendas.
 */
export function NuevaTienda() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creada, setCreada] = useState<Creada | null>(null);

  async function crear() {
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/panel/tiendas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre,
        email,
        // Vacío = que el CRM genere una fuerte.
        ...(password.trim() ? { password: password.trim() } : {}),
      }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { message?: string } | null;
      setError(data?.message ?? "No se pudo crear la tienda");
      setOcupado(false);
      return;
    }
    setCreada((await res.json()) as Creada);
    setNombre("");
    setEmail("");
    setPassword("");
    setOcupado(false);
    // Las tarjetas de abajo son del servidor: sin esto la tienda nueva no aparece.
    router.refresh();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <CardTitle className="text-[15px]">Nueva tienda</CardTitle>
          <CardDescription className="mt-1">
            Crea el espacio del cliente —organización, propietario y pipeline— y
            te da la contraseña inicial para entregarle el acceso. Con el registro
            abierto, él también puede creársela solo desde <code>/register</code>.
          </CardDescription>
        </div>
        <Button
          variant={abierto ? "outline" : "default"}
          size="sm"
          aria-expanded={abierto}
          onClick={() => setAbierto((v) => !v)}
        >
          <Plus className="h-4 w-4" />
          {abierto ? "Cerrar" : "Crear tienda"}
        </Button>
      </div>

      {abierto && (
        <CardContent className="border-t pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <Label htmlFor="nt-nombre">Nombre del negocio</Label>
              <Input
                id="nt-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Uniko RD"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label htmlFor="nt-email">Correo del cliente</Label>
              <Input
                id="nt-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dueno@negocio.com"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label htmlFor="nt-password">Contraseña inicial (opcional)</Label>
              <Input
                id="nt-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Si la dejas vacía, se genera una"
              />
            </label>
          </div>

          {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

          <div className="mt-4">
            <Button onClick={crear} disabled={ocupado || nombre.trim().length < 2 || !email.trim()}>
              {ocupado ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Crear tienda
            </Button>
          </div>

          {creada && (
            <div className="mt-4 rounded-lg border border-info-soft bg-info-tint p-3 text-[13px] text-info-text">
              <p className="font-semibold text-foreground">
                {creada.nombre} creada. Estos son los accesos del cliente, se
                muestran una sola vez:
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <KeyRound className="h-4 w-4 shrink-0 text-text-3" aria-hidden />
                <span className="font-mono">{creada.email}</span>
                <span className="text-text-3">/</span>
                <span className="font-mono">{creada.password}</span>
              </p>
              <p className="mt-2 text-text-2">
                Que entren por <span className="font-mono">/login</span>, cambien
                la contraseña y sigan la guía de inicio. Para dejarles el bot
                montado tú mismo, entra ahora:
              </p>
              <div className="mt-2">
                <BotonGestion
                  organizationId={creada.organizationId}
                  nombre={creada.nombre}
                />
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
