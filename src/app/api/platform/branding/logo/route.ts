import { rm } from "node:fs/promises";
import { apiError, withPanel } from "@/lib/api";
import {
  FAVICON_ASSET,
  MAX_FAVICON_BYTES,
  MAX_FAVICON_MB,
  sniffFaviconMime,
} from "@/lib/favicon";
import {
  PLATFORM_LOGO_DIR,
  getPlatformBranding,
  savePlatformBranding,
} from "@/server/platform-branding";
import { mediaFilePath, saveMediaFile } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

/**
 * El logo de la plataforma, en crudo (sin multipart) y con el mismo tope de
 * 5 MB que el de una tienda. Vive en `MEDIA_DIR/__plataforma__/favicon`, una
 * carpeta reservada que ningún id de organización puede producir.
 *
 * El `content-type` del cliente no manda: el tipo se sniffa de los bytes, igual
 * que en las tiendas, porque esto se sirve desde el dominio de la instancia.
 */
export const PUT = withPanel(async (_admin, req: Request) => {
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0) {
    return apiError(422, "empty", "No llegó ningún archivo");
  }
  if (buf.byteLength > MAX_FAVICON_BYTES) {
    return apiError(413, "too_large", `El logo no puede pasar de ${MAX_FAVICON_MB} MB`);
  }
  const mime = sniffFaviconMime(buf);
  if (!mime) {
    return apiError(
      422,
      "unsupported",
      "Formato no reconocido. Usa PNG, SVG, ICO, JPEG o WebP."
    );
  }

  await saveMediaFile(PLATFORM_LOGO_DIR, FAVICON_ASSET, buf);
  const version = Date.now();
  // El logo va como segundo argumento, que es la columna que se escribe; el
  // `favicon` de la marca no es un campo de esta tabla.
  await savePlatformBranding(await getPlatformBranding(), { mime, version });
  return Response.json({ favicon: { mime, version } });
});

/** Volver al logo de la instancia (el embebido en el código). */
export const DELETE = withPanel(async () => {
  await savePlatformBranding(await getPlatformBranding(), null);
  await rm(mediaFilePath(PLATFORM_LOGO_DIR, FAVICON_ASSET), { force: true }).catch(
    () => null
  );
  return Response.json({ favicon: null });
});
