"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import {
  ACCENT_PRESETS,
  DEFAULT_BRANDING,
  MAX_BRANDING_DESCRIPTION,
  isValidHex,
  resolveAccentSet,
  resolveNavAccentSet,
  type AccentSet,
  type Branding,
} from "@/lib/branding";
import { CURRENCY_GROUPS, CURRENCY_OPTIONS, type Currency } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/components/use-theme";
import { BrandLogo } from "@/components/brand-mark";
import { navItemClass } from "@/components/app-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FaviconCard } from "@/components/settings/favicon-card";

/** Los tokens del acento, para sobreescribirlos SOLO dentro de una caja. */
function accentVars(s: AccentSet): React.CSSProperties {
  return {
    "--accent": s.accent,
    "--accent-hover": s.hover,
    "--accent-soft": s.soft,
    "--accent-tint": s.tint,
    "--accent-text": s.text,
    "--accent-fg": s.fg,
  } as React.CSSProperties;
}

export function BrandingClient({ branding }: { branding: Branding }) {
  const router = useRouter();
  const mode = useResolvedTheme();
  const [name, setName] = useState(branding.name);
  const [description, setDescription] = useState(branding.description);
  const [accent, setAccent] = useState<string>(branding.accent);
  const [currency, setCurrency] = useState<Currency>(branding.currency);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Lo que el muestreo del logo recién subido encontró (o no): se enseña una
  // sola vez, junto al botón, y se va en cuanto se toca el color a mano.
  const [heredado, setHeredado] = useState<string | null>(null);
  /**
   * La marca GUARDADA, aparte de lo que se está editando. La tarjeta del logo
   * la usa para armar la URL versionada del icono: si recibiera el formulario
   * en vivo, cada letra del nombre recompondría el `?v=` del generado y el
   * navegador iría pidiendo un icono nuevo a cada pulsación.
   */
  const [base, setBase] = useState(branding);

  const isPreset = accent.toLowerCase() in ACCENT_PRESETS;
  // La vista previa muestra el acento tal como se verá en el tema activo: los
  // presets están pensados para fondo claro y en oscuro se aclaran. La barra
  // lateral es azul marino en los dos temas y lleva su propio cálculo.
  const previewSet = resolveAccentSet(accent, mode);
  const navSet = resolveNavAccentSet(accent);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/settings/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        accent,
        currency,
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
    // El servidor conserva el logo subido, así que la marca guardada es la que
    // estaba con estos cuatro campos nuevos.
    setBase((b) => ({
      ...b,
      name: name.trim(),
      accent,
      currency,
      description: description.trim(),
    }));
    // Re-renderiza el árbol server (layout raíz inyecta el acento y el título)
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Marca de tu tienda</CardTitle>
          <CardDescription>
            Esto es tuyo y solo tuyo: el nombre, el logo y el color se aplican
            a tu espacio de trabajo. El aspecto general de la plataforma no
            cambia con ello, y nadie más ve tu marca.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Nombre</Label>
            <Input
              id="brand-name"
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={DEFAULT_BRANDING.name}
              className="max-w-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-description">Descripción</Label>
            <Textarea
              id="brand-description"
              rows={2}
              maxLength={MAX_BRANDING_DESCRIPTION}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Qué vende tu negocio, en una línea."
            />
            <p className="text-xs text-text-3">
              Se usa donde tu marca se presenta sola: la descripción de la
              página y el detalle de tu tienda en el panel de la plataforma.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-currency">Moneda del negocio</Label>
            <select
              id="brand-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="h-9 max-w-xs rounded-md border border-input bg-card px-2 text-sm"
            >
              {CURRENCY_GROUPS.map((g) => (
                <optgroup key={g.id} label={g.label}>
                  {CURRENCY_OPTIONS.filter((c) => c.group === g.id).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name} ({c.where})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs text-text-3">
              Es la única que el Pipeline suma. Los montos capturados en otra
              moneda se muestran, pero quedan fuera del total de su columna.
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
                  !isPreset ? "border-text-2 bg-secondary" : "border-border-strong hover:bg-accent"
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
            <p className="text-xs text-text-3">
              Con un color personalizado, los tonos derivados (hover, fondos
              suaves) se calculan solos y se ajusta el contraste.
            </p>
          </div>

          {/* Vista previa: el bicolor real en miniatura, con el color que se
              está eligiendo (aún sin guardar). A la izquierda la barra, con la
              misma clase (`nav-dark`) y el mismo renglón activo que la de
              verdad; a la derecha la página en el tema activo, con su botón. */}
          <div
            aria-label="Vista previa de la marca"
            className="flex flex-col overflow-hidden rounded-md border border-border-strong sm:flex-row"
          >
            <div
              className="nav-dark shrink-0 bg-subtle p-3 text-foreground sm:w-60"
              style={accentVars(navSet)}
            >
              <div className="px-2 pt-0.5">
                <BrandLogo
                  branding={{
                    name: name.trim() || DEFAULT_BRANDING.name,
                    accent,
                    favicon: base.favicon,
                  }}
                />
                <span className="kicker mt-2 block">CRM · WhatsApp</span>
              </div>
              <span className={cn(navItemClass(true), "mt-3")}>
                <Inbox className="h-[17px] w-[17px] text-brand" strokeWidth={1.8} />
                <span className="flex-1">Bandeja</span>
              </span>
            </div>
            <div
              className="flex flex-1 items-center justify-center border-t border-border-strong bg-background p-4 sm:border-l sm:border-t-0"
              style={accentVars(previewSet)}
            >
              <span className="rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-brand-fg shadow-sm">
                Botón de ejemplo
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm" style={{ color: previewSet.text }}>Marca guardada ✓</p>}
          <Button disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar marca"}
          </Button>
        </CardContent>
      </Card>

      <FaviconCard
        branding={base}
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
        <p className="-mt-3 text-xs text-text-3">
          El logo subido no tiene un color reconocible (es gris, o es SVG):
          deja el acento que elijas tú.
        </p>
      )}
      {heredado && (
        <p className="-mt-3 text-xs" style={{ color: previewSet.text }}>
          Acento heredado del logo <b>{heredado}</b>. Puedes cambiarlo arriba
          y luego guardar.
        </p>
      )}
    </div>
  );
}
