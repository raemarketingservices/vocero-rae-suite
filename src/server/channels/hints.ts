import type { Channel } from "@/lib/channels";
import { capabilitiesFor } from "@/server/channels/capabilities";

/**
 * La pista accionable que acompaña a un fallo de envío.
 *
 * Adaptado de Builder CRM (MIT, Copyright (c) 2026 Diego Vásquez),
 * `hintForZernioError` en `src/lib/channels/conectores/zernio.ts`; ver NOTICE.
 *
 * El `message` de un fallo del proveedor viene en su idioma y en su vocabulario,
 * y no le dice a quien atiende la bandeja qué hacer con eso. La pista es esa
 * acción. Cuando no hay nada útil que decir devuelve `undefined` y la bandeja
 * muestra solo el mensaje: una pista inventada es peor que ninguna, porque se
 * cree.
 *
 * Los códigos numéricos de Meta NO se traducen aquí: ya existe la tabla curada
 * de `lib/meta/send-errors.ts`, y tener el 131047 explicado en dos sitios es
 * tenerlo mal explicado en uno.
 */
export function hintParaFalloDeEnvio(fallo: {
  channel: Channel;
  status: number;
  /** Código del proveedor: texto en Zernio, número en la Graph API. */
  code?: string | number | null;
}): string | undefined {
  const { channel, status } = fallo;
  const code =
    typeof fallo.code === "string" ? fallo.code.toUpperCase() : (fallo.code ?? null);
  const caps = capabilitiesFor(channel);

  // Zernio nombra la ventana cerrada con un texto suyo, no con el código de Meta.
  if (code === "TEMPLATE_REQUIRED" || code === "REENGAGEMENT_MESSAGE") {
    return caps.outsideWindow === "template"
      ? "Meta cerró la ventana de 24 horas: para volver a escribirle hay que mandar una plantilla aprobada."
      : `La ventana de 24 horas de ${caps.label} está cerrada y este canal no tiene plantillas.`;
  }

  if (status === 401 || status === 403) {
    return "El proveedor rechazó las credenciales. Revísalas en Configuración → Canales y vuelve a guardarlas.";
  }

  if (status === 402) {
    return "La cuenta del proveedor no tiene plan o saldo activo: el envío no sale hasta que se resuelva eso.";
  }

  if (status === 429) {
    return "El proveedor está limitando los envíos de esta cuenta. Espera unos minutos y reintenta.";
  }

  // Un 400 en Instagram o Messenger casi siempre es la ventana: esas plataformas
  // no devuelven el código de re-engagement que sí da WhatsApp.
  if (status === 400 && channel !== "whatsapp") {
    return "Puede que el mensaje haya caído fuera de la ventana de 24 horas.";
  }

  return undefined;
}
