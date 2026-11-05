"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck, Users } from "lucide-react";
import { signIn } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [recordar, setRecordar] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signIn.email({
      email,
      password,
      rememberMe: recordar,
    });
    setLoading(false);
    if (err) {
      setError(
        err.status === 429
          ? "Demasiados intentos. Espera unos minutos."
          : "Correo o contraseña incorrectos."
      );
      return;
    }
    // A la raíz, no a la Bandeja: ahí se decide si toca la guía de inicio
    // (#86) o la Bandeja de siempre.
    router.push("/");
    router.refresh();
  }

  return (
    <Card className="shadow-md">
      <CardContent className="space-y-5 p-6 sm:p-7">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong text-brand-ink">
            <Lock className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <p className="kicker">Acceso a la plataforma</p>
        </div>

        <div className="space-y-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">
            Bienvenido de nuevo
          </h1>
          <p className="text-[14px] text-text-2">
            Inicia sesión para continuar con tu negocio.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo electrónico</Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
                aria-hidden
              />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder="nombre@empresa.com"
                className="pl-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
                aria-hidden
              />
              <Input
                id="password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                required
                className="pl-9 pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? "Ocultar la contraseña" : "Mostrar la contraseña"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-text-3 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {visible ? (
                  <EyeOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text-2">
              <input
                type="checkbox"
                checked={recordar}
                onChange={(e) => setRecordar(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              Recordarme
            </label>
            <p className="text-right text-[12.5px] text-text-3">
              ¿Olvidaste tu contraseña? Tu administrador te la restablece.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full gap-2" disabled={loading}>
            {loading ? "Entrando…" : "Iniciar sesión"}
            {!loading && <ArrowRight className="h-4 w-4" aria-hidden />}
          </Button>
        </form>

        <div className="space-y-3 border-t pt-4">
          <p className="text-center text-[13px] text-text-2">
            ¿Aún no tienes una cuenta?
          </p>
          {/* Enlace, no botón: navega. `Button` no tiene `asChild`, así que se
              le pone su propia clase encima. */}
          <Link
            href="/register"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "w-full gap-2 text-brand-ink"
            )}
          >
            <Users className="h-4 w-4" aria-hidden />
            Crear cuenta de negocio
          </Link>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-[12.5px] text-text-3">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Tu información, siempre protegida.
        </p>
      </CardContent>
    </Card>
  );
}
