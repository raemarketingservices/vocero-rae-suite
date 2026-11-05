import type { Branding } from "@/lib/branding";
import { BRAND_LOGO_SRC, isInstanceBrand } from "@/lib/brand";
import { faviconHref, faviconInitial } from "@/lib/favicon";
import { cn } from "@/lib/utils";

/**
 * Lo que la marca necesita para dibujarse: el nombre, el acento y si hay
 * logo subido (el acento entra en la URL versionada del icono generado).
 */
export type BrandingMark = Pick<Branding, "name" | "accent" | "favicon">;

/**
 * El logo de la plataforma: el círculo de RAE Marketing Services con fondo
 * transparente, tal cual sale de `public/brand`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    // Sin next/image a propósito: es un estático pequeño y versionado por el
    // build; pasarlo por el optimizador sería trabajo para no ahorrar.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={BRAND_LOGO_SRC} alt="" aria-hidden className={cn("object-contain", className)} />
  );
}

/**
 * Mosaico cuadrado con degradado del acento: es el favicon en grande. Con un
 * logo subido lleva el logo (el MISMO archivo y la MISMA URL versionada que
 * la pestaña, así lo que se sube en Ajustes → Marca se ve en los dos sitios);
 * la marca de la plataforma dibuja su círculo sin mosaico detrás; un espacio
 * rebautizado, la inicial de su nombre.
 */
export function BrandTile({
  branding,
  className,
}: {
  branding: BrandingMark;
  className?: string;
}) {
  const instance = isInstanceBrand(branding.name) && !branding.favicon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden text-brand-fg",
        !instance && "brand-tile",
        className
      )}
      aria-hidden
    >
      {branding.favicon ? (
        // Sin next/image a propósito: es un archivo de una ruta propia, ya
        // pequeño; pasarlo por el optimizador sería trabajo para no ahorrar.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={faviconHref(branding)}
          alt=""
          className="h-full w-full object-contain"
        />
      ) : instance ? (
        <BrandMark className="h-full w-full" />
      ) : (
        <span className="font-bold leading-none">{faviconInitial(branding.name)}</span>
      )}
    </span>
  );
}

const TILE_SIZE = {
  md: "h-[30px] w-[30px] rounded-[9px] text-[15px]",
  lg: "h-[44px] w-[44px] rounded-[13px] text-[22px]",
} as const;

/**
 * La marca completa: mosaico (o logo de la plataforma) + nombre del espacio.
 * Una instancia rebautizada ve su inicial y su nombre (white-label); quien
 * sube un logo lo ve aunque se llame como se llame.
 *
 * `multiline` es para las barras laterales angostas: un nombre de tres palabras
 * ("RAE Marketing Services") con `truncate` se leía "RAE Marketing…", que es
 * exactamente el reclamo del admin. Cortar por palabras cuesta una línea más
 * de barra; cortar por puntos suspensivos cuesta la marca entera.
 */
export function BrandLogo({
  branding,
  size = "md",
  multiline = false,
  className,
}: {
  branding: BrandingMark;
  size?: keyof typeof TILE_SIZE;
  multiline?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-2.5",
        multiline && "items-start",
        className
      )}
    >
      <BrandTile
        branding={branding}
        className={cn(TILE_SIZE[size], multiline && "mt-0.5")}
      />
      <span
        className={cn(
          "font-[750] tracking-tight",
          multiline
            ? "leading-[1.12] [text-wrap:balance] break-words"
            : "truncate leading-none",
          size === "lg" ? "text-[26px]" : "text-[17px]"
        )}
      >
        {branding.name}
      </span>
    </span>
  );
}
