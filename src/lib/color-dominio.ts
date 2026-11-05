/**
 * El color dominante de un logo, para heredar de él el acento del CRM.
 *
 * Puro y sobre bytes crudos RGBA: quien lo llama saca los píxeles con un
 * canvas en el navegador, y aquí no hay DOM que simular en las pruebas.
 *
 * No es "el color más frecuente", que en un logo casi siempre es el fondo
 * blanco. Se descartan los neutros y los extremos y se puntúa cada cubo por
 * cuántos píxeles lo pueblan y por cuán saturado está, así que un logo con un
 * 90 % de blanco y un 10 % de verde esmeralda devuelve verde esmeralda.
 */

/** Neutro por debajo de esta diferencia de canales: blanco, gris, negro. */
const NEUTRAL = 22;
/** Fondo claro (o tinta opaca) por encima/debajo de estos umbrales. */
const MUY_CLARO = 236;
const MUY_OSCURO = 24;
/** Píxeles como máximo que se miran: basta para un histograma estable. */
const MUESTRA = 4096;

export type Rgb = { r: number; g: number; b: number };

export function hexDe({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function saturacion(r: number, g: number, b: number): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/**
 * `#rrggbb` del color dominante, o `null` si el logo no tiene ninguno: uno
 * gris no da adivinar un acento y es mejor decirlo que inventar un azul.
 */
export function colorDominante(rgba: Uint8ClampedArray, total?: number): string | null {
  const pixeles = total ?? rgba.length / 4;
  if (pixeles <= 0) return null;
  const paso = Math.max(1, Math.floor(pixeles / MUESTRA));

  type Cubo = { n: number; r: number; g: number; b: number };
  const cubos = new Map<number, Cubo>();

  for (let i = 0; i < pixeles; i += paso) {
    const o = i * 4;
    if ((rgba[o + 3] ?? 0) < 128) continue; // transparente: es el fondo del lienzo
    const r = rgba[o] ?? 0;
    const g = rgba[o + 1] ?? 0;
    const b = rgba[o + 2] ?? 0;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < NEUTRAL) continue; // neutro
    if (min > MUY_CLARO || max < MUY_OSCURO) continue; // casi blanco o casi negro

    // Cubo de 5 bits por canal: agrupa el mismo verde escrito de 20 formas.
    const clave = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const c = cubos.get(clave) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += r;
    c.g += g;
    c.b += b;
    cubos.set(clave, c);
  }

  let mejor: Cubo | null = null;
  let mejorPuntos = 0;
  for (const c of cubos.values()) {
    const puntos = c.n * (1 + saturacion(c.r / c.n, c.g / c.n, c.b / c.n) * 2);
    if (puntos > mejorPuntos) {
      mejorPuntos = puntos;
      mejor = c;
    }
  }
  if (!mejor) return null;
  return hexDe({ r: mejor.r / mejor.n, g: mejor.g / mejor.n, b: mejor.b / mejor.n });
}
