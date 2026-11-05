"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACCENT_PRESETS,
  DEFAULT_BRANDING,
  MAX_BRANDING_DESCRIPTION,
  isValidHex,
  resolveAccentSet,
  type Branding,
} from "@/lib/branding";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/components/use-theme";
import { BrandLogo } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FaviconCard } from "@/components/settings/favicon-card";

/**
 * La marca de la PLATAFORMA, editada por el admin de RAE.
 *
 * Es el otro lado de la frontera que pidió el usuario: cada tienda cambia la
 * suya en Ajustes → Marca y eso no mueve el aspecto general del CRM; lo que
 * cambia el aspecto general —lo que ve quien todavía no entró y lo que ve el
 * panel— es esta pantalla, y solo está en la lista de `PLATFORM_ADMIN_EMAILS`.
 */
export function MarcaPlataforma({ branding }: { branding: Branding }) {
  const router = useRouter();
  const mode = useResolvedTheme();
  const [name, setName] = useState(branding.name);
  const [description, setDescription] = useState(branding.description);
  const [accent, setAccent] = useState(branding.accent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [heredado, setHeredado] = useState<string | null>(null);
  /** La marca guardada, para la URL versionada del logo (ver `base` en la pantalla de tienda). */
  const [base, setBase] = useState(branding);

  // `!x in obj` se parsea como `(!x) in obj` y siempre es falso: el preset hay
  // que comprobarlo antes.
  const isPreset = accent.toLowerCase() in ACCENT_PRESETS;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/platform/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        accent,
        description: description.trim(),
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar");
      return;
    }
    setSaved(true);
    setBase((b) => ({
      ...b,
      name: name.trim(),
      accent,
      description: description.trim(),
    }));
    // El layout raíz vuelve a emitir el acento y el título: sin esto, el color
    // nuevo se vería hasta el siguiente F5.
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-[28px] font-bold tracking-tight text-foreground sm:text-[32px]">
        Marca de la plataforma
      </h1>
      <p className="mt-1.5 max-w-2xl text-[14px] text-text-2">
        Lo que ve quien entra a <span className="font-mono">/login</span>, la
        pestaña del navegador y el cascarón de este panel. Las tiendas siguen
        con su propia marca en Ajustes → Marca: cambiar nada de aquí no toca el
        aspecto de nadie dentro de su CRM.
      </p>

      <div className="mt-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Identidad de RAE</CardTitle>
            <CardDescription>
              Nombre, una línea que la describa y el color de acento con el que
              se calculan los tonos de toda la interfaz.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="pb-name">Nombre</Label>
              <Input
                id="pb-name"
                maxLength={30}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={DEFAULT_BRANDING.name}
                className="max-w-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pb-description">Descripción</Label>
              <Textarea
                id="pb-description"
                rows={2}
                maxLength={MAX_BRANDING_DESCRIPTION}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Qué es la plataforma, en una línea."
              />
              <p className="text-xs text-text-3">
                Es el texto que sale en la pestaña y en lo que los buscadores y
                los mensajes muestran de la página de acceso.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Color de acento</Label>
              <div className="flex flex-wrap items-center gap-2">
                {Object.entries(ACCENT_PRESETS).map(([hex, preset]) => (
                  <button
                    key={hex}
                    onClick={() => {
                      setAccent(hex);
                      setHeredado(null);
                    }}
                    title={preset.label}
                    aria-label={preset.label}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                      accent.toLowerCase() === hex
                        ? "border-text-2 bg-secondary"
                        : "border-border-strong hover:bg-accent"
                    )}
                  >
                    <span
                      className="h-4 w-4 rounded-full"
                      style={{ background: resolveAccentSet(hex, mode).accent }}
                    />
                    {preset.label}
                  </button>
                ))}
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                    !isPreset
                      ? "border-text-2 bg-secondary"
                      : "border-border-strong hover:bg-accent"
                  )}
                >
                  <input
                    type="color"
                    value={isValidHex(accent) ? accent : DEFAULT_BRANDING.accent}
                    onChange={(e) => {
                      setAccent(e.target.value);
                      setHeredado(null);
                    }}
                    className="h-4 w-4 cursor-pointer appearance-none border-0 bg-transparent p-0"
                  />
                  Personalizado
                </label>
              </div>
            </div>

            <div className="rounded-lg border bg-subtle p-4">
              <p className="kicker mb-2">Así se ve ahora</p>
              <BrandLogo branding={{ name: name.trim() || DEFAULT_BRANDING.name, accent, favicon: base.favicon }} multiline />
            </div>

            {heredado && (
              <p className="text-xs text-text-3">
                Acento heredado del logo{" "}
                <span className="font-mono">{heredado}</span>. Puedes cambiarlo
                arriba y luego guardar.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {saved && <p className="text-sm text-success-text">Marca guardada ✓</p>}

            <div className="flex gap-2">
              <Button disabled={saving || !name.trim()} onClick={() => void save()}>
                {saving ? "Guardando…" : "Guardar marca"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <FaviconCard
          branding={base}
          ruta="/api/platform/branding/logo"
          titulo="Logo de la plataforma"
          ayuda="Se ve en la pestaña del navegador, en la barra del panel y en la pantalla de acceso."
          onColorExtraido={(hex) => {
            if (!hex) {
              setHeredado("");
              return;
            }
            setAccent(hex);
            setHeredado(hex);
          }}
        />
        {heredado === "" && (
          <p className="-mt-4 text-xs text-text-3">
            El logo subido no tiene un color reconocible (es gris, o es SVG):
            deja el acento que elijas tú.
          </p>
        )}
      </div>
    </div>
  );
}
