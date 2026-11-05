import { readMediaFile } from "@/server/whatsapp/media";
import { brandingDePeticion } from "@/server/branding";
import { PLATFORM_LOGO_DIR } from "@/server/platform-branding";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { FAVICON_ASSET, generatedFaviconSvg } from "@/lib/favicon";

export const dynamic = "force-dynamic";

/**
 * Cabeceras con las que se sirve CUALQUIER icono, subido o generado.
 *
 * Un SVG que sube el dueño es un documento con permiso de ejecutar guiones si
 * alguien navega a su URL. La CSP lo deja sin nada que ejecutar y `nosniff`
 * impide que el navegador reinterprete el tipo. Cuesta dos cabeceras y quita
 * de la mesa toda esa clase de problema.
 *
 * `private` cuando el icono depende de la sesión: la respuesta NO es la misma
 * para dos tiendas, así que ninguna caché compartida puede reutilizarla. El
 * de la plataforma, que es idéntico para todos, sigue siendo cacheable en
 * común.
 */
function cabeceras(mime: string, cacheable: boolean, privado: boolean): HeadersInit {
  return {
    "content-type": mime,
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "x-content-type-options": "nosniff",
    // La URL lleva `?v=` y cambia con la marca, así que se puede cachear
    // fuerte. Sin ese sufijo —alguien pidiendo la ruta pelada— no.
    "cache-control": cacheable
      ? `${privado ? "private" : "public"}, max-age=31536000, immutable`
      : `${privado ? "private" : "public"}, max-age=60`,
  };
}

/**
 * El icono de la pestaña. **Ruta pública**: el login también tiene pestaña, y
 * ahí todavía no hay sesión.
 *
 * Con sesión sirve el logo de ESA tienda y sin ella el de la plataforma; la
 * organización nunca sale de un parámetro de la URL, siempre de la sesión, así
 * que nadie puede pedir el logo de otro escribiendo su id.
 */
export async function GET(req: Request) {
  const cacheable = new URL(req.url).searchParams.has("v");
  const ctx = await brandingDePeticion().catch(() => null);
  const branding = ctx?.branding ?? DEFAULT_BRANDING;
  // Sin organización propia, el logo vive en la carpeta reservada de la
  // plataforma; con ella, en la carpeta de esa tienda.
  const carpeta = ctx?.organizationId ?? PLATFORM_LOGO_DIR;
  const plataforma = !ctx?.organizationId;

  if (branding.favicon) {
    try {
      const buf = await readMediaFile(carpeta, FAVICON_ASSET);
      return new Response(new Uint8Array(buf), {
        headers: cabeceras(branding.favicon.mime, cacheable, !plataforma),
      });
    } catch {
      // El archivo se perdió (volumen sin montar, restauración a medias). Se
      // cae al generado en vez de dejar la pestaña sin icono: un 404 aquí se
      // ve como si la instancia estuviera rota.
    }
  }

  return new Response(generatedFaviconSvg(branding), {
    headers: cabeceras("image/svg+xml", cacheable, !plataforma),
  });
}
