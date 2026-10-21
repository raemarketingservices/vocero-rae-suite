import { DEFAULT_BRANDING } from "./branding";

/**
 * La marca de la instancia: RAE Marketing Services.
 *
 * Vive aquí, sin React, porque la usan dos mundos: los componentes (el logo
 * del panel lateral y del login) y el servidor (el favicon generado que se
 * sirve como texto). Tener la ruta y el nombre en un solo sitio es lo que
 * garantiza que la pestaña y la barra lateral enseñen la MISMA marca.
 */

/** Logo circular servido desde `public/brand` (fondo transparente). */
export const BRAND_LOGO_SRC = "/brand/rae-logo.png";

/** Azul principal de la marca (guía de estilo RAE). */
export const BRAND_BLUE = "#2d4aff";

/** Azul claro de la marca: remates y resplandores. */
export const BRAND_BLUE_LIGHT = "#4ea1ff";

/** Azul oscuro de la marca: barra lateral y superficies profundas. */
export const BRAND_BLUE_DARK = "#0f2d6b";

/**
 * ¿Esta organización conserva la marca de la instancia? Solo entonces se
 * dibuja el logo de RAE: un cliente que rebautizó su espacio en
 * Configuración → Marca ve su propio nombre con la inicial, no el logo de
 * la plataforma.
 */
export function isInstanceBrand(name: string): boolean {
  return name.trim().toLowerCase() === DEFAULT_BRANDING.name.toLowerCase();
}
