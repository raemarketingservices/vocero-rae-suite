"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "lucide-react";
import type { Branding } from "@/lib/branding";
import {
  faviconHref,
  FAVICON_MIMES,
  MAX_FAVICON_BYTES,
  MAX_FAVICON_MB,
  RECOMMENDED_FAVICON_BYTES,
} from "@/lib/favicon";
import { colorDominante } from "@/lib/color-dominio";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * El color del logo, leído en el navegador.
 *
 * `createImageBitmap` y un canvas de 128 px: se reduce antes de muestrear para
 * no recorrer los tres millones de píxeles de un PNG grande, y el histograma de
 * `colorDominante` es estable aunque la muestra cambie. Devuelve `null` para
 * SVG (un vector no es píxeles y `createImageBitmap` no lo decodifica de forma
 * fiable en todos los navegadores) y para ICO multiresolución, y la pantalla lo
 * dice en vez de inventar un azul.
 */
async function colorDeArchivo(file: File): Promise<string | null> {
  if (file.type === "image/svg+xml") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const lado = 128;
    const canvas = document.createElement("canvas");
    canvas.width = lado;
    canvas.height = lado;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, lado, lado);
    ctx.drawImage(bitmap, 0, 0, lado, lado);
    bitmap.close();
    return colorDominante(ctx.getImageData(0, 0, lado, lado).data);
  } catch {
    return null;
  }
}

/**
 * El icono de la pestaña y el logo de la barra lateral.
 *
 * Se muestra SIEMPRE una vista previa: sin logo subido, la del icono generado
 * con la inicial y el acento. Así queda claro que la instancia ya tiene uno y
 * que subir algo es reemplazarlo, no estrenarlo.
 *
 * Al subir, además se lee el color del logo y se sube al padre: el acento de la
 * tienda puede heredarse de la marca real sin que nadie tenga que pedirle al
 * diseñador el código hexadecimal.
 */
export function FaviconCard({
  branding,
  onColorExtraido,
  ruta = "/api/settings/branding/favicon",
  titulo = "Logo del negocio",
  ayuda = "Se ve en la pestaña del navegador y en la barra lateral del CRM.",
}: {
  branding: Branding;
  onColorExtraido?: (hex: string | null) => void;
  /**
   * A dónde se sube. Es un parámetro porque la tarjeta sirve a los dos dueños
   * del mismo dato: una tienda (su marca) y la plataforma (la marca de RAE),
   * que tienen rutas distintas y el mismo formato, el mismo tope y la misma
   * lectura del color.
   */
  ruta?: string;
  titulo?: string;
  ayuda?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Cambia con cada carga para que la vista previa no se quede con la anterior.
  const [rev, setRev] = useState(0);
  const [actual, setActual] = useState(branding.favicon);

  const src = `${faviconHref({ ...branding, favicon: actual })}&r=${rev}`;

  async function subir(file: File) {
    setError(null);
    setAviso(null);
    if (file.size > MAX_FAVICON_BYTES) {
      setError(`El logo no puede pasar de ${MAX_FAVICON_MB} MB.`);
      return;
    }
    // El color se lee del archivo en memoria, antes de la red: si el servidor
    // lo rechaza no hay que heredar nada de un logo que no se guardó.
    const color = await colorDeArchivo(file);
    setSubiendo(true);
    const res = await fetch(ruta, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    }).catch(() => null);
    setSubiendo(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo subir el logo");
      return;
    }
    if (file.size > RECOMMENDED_FAVICON_BYTES) {
      // No se bloquea: un logo grande es válido, solo queda pesado en la
      // pestaña. Que lo sepa quien lo sube y pueda exportarlo más pequeño.
      setAviso(
        `Se guardó, pero pesa ${(file.size / (1024 * 1024)).toFixed(1)} MB. Con 512 px cuadrados basta y carga más rápido.`
      );
    }
    const data = (await res.json()) as { favicon: Branding["favicon"] };
    setActual(data.favicon);
    setRev((v) => v + 1);
    onColorExtraido?.(color);
    router.refresh(); // el layout raíz vuelve a emitir el <link rel="icon">
  }

  async function quitar() {
    setError(null);
    setAviso(null);
    setSubiendo(true);
    const res = await fetch(ruta, {
      method: "DELETE",
    }).catch(() => null);
    setSubiendo(false);
    if (!res?.ok) {
      setError("No se pudo quitar el logo");
      return;
    }
    setActual(null);
    setRev((v) => v + 1);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        <p className="text-sm text-text-3">
          {ayuda}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          {/* Sin next/image a propósito: es un archivo servido por una ruta
              propia, de 64 px y ya optimizado. Pasarlo por el optimizador
              sería trabajo de servidor para no ahorrar nada. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Vista previa del icono de la pestaña"
            width={48}
            height={48}
            className="h-12 w-12 rounded-lg border bg-card object-contain"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {actual ? "Logo propio" : "Generado con tu marca"}
            </p>
            <p className="mt-0.5 text-xs text-text-3">
              {actual
                ? "Reemplaza al generado en la pestaña y en la barra lateral. Puedes quitarlo para volver a él."
                : "La inicial sobre tu color de acento. Sube tu logo para reemplazarla."}
            </p>
          </div>
        </div>

        <input
          ref={input}
          type="file"
          accept={FAVICON_MIMES.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Se limpia el valor para que subir el MISMO archivo dos veces
            // vuelva a disparar el evento.
            e.target.value = "";
            if (f) void subir(f);
          }}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={subiendo}
            onClick={() => input.current?.click()}
          >
            <ImageUp className="h-4 w-4" />
            {subiendo ? "Subiendo…" : actual ? "Cambiar logo" : "Subir logo"}
          </Button>
          {actual && (
            <Button variant="ghost" disabled={subiendo} onClick={() => void quitar()}>
              <Trash2 className="h-4 w-4" /> Quitar
            </Button>
          )}
        </div>

        <p className="text-xs text-text-3">
          PNG, SVG, ICO, JPEG o WebP, hasta {MAX_FAVICON_MB} MB. Cuadrado y con fondo
          transparente se ve mejor: se dibuja sobre tu color de acento.
          {onColorExtraido &&
            " Al subir un PNG o JPEG leemos su color dominante y te proponemos el acento."}
        </p>

        {aviso && <p className="text-sm text-warning-text">{aviso}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
