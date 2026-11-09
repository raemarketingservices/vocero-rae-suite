/**
 * Patrón de RESPALDO de intención de escalado (FR-022). Se evalúa sobre el
 * mensaje del cliente ANTES del LLM: si matchea, el handoff ocurre aunque el
 * modelo no lo detecte. Diseñado para exigir un verbo de contacto cerca del
 * objeto humano — "somos 4 personas" NO matchea (test unitario).
 */
export const HANDOFF_BACKUP_REGEX =
  /(hablar|comunicar|contactar)[\s\S]{0,40}?(asesor|humano|persona|alguien)|un asesor|un humano|p[aá]s[ae]me con|atenci[oó]n humana/i;

export function matchesHandoffIntent(text: string): boolean {
  return HANDOFF_BACKUP_REGEX.test(text);
}

/**
 * Lo que oye el cliente cuando el patrón de respaldo lo traspasa.
 *
 * El camino del modelo se despide con su `farewell`; este no mandaba NADA, y
 * justo atrapa las peticiones más directas («quiero hablar con un humano»).
 * El traspaso ocurría por dentro, pero del lado de WhatsApp se leía como que
 * el bot había dejado de contestar a quien pidió una persona.
 *
 * Es fijo porque el perfil del agente no tiene un campo para esto
 * (`escalationRules` dice CUÁNDO escalar, no qué decir) y el turno corta
 * antes del modelo a propósito: no hay de dónde sacar otro texto. No promete
 * un plazo ni un nombre que el CRM no conoce.
 */
export const HANDOFF_BACKUP_ACK =
  "Claro, te comunico con una persona del equipo. En breve te responden.";

/**
 * Oferta de hablar con una persona: sale una vez por chat, tras la primera
 * respuesta del bot. El texto pide «Sí o No» porque los botones solo existen
 * en WhatsApp por Zernio; en los demás canales el cliente lo escribe.
 * El turno reconoce la oferta por este texto exacto.
 */
export const OFERTA_HUMANO =
  "¿Quieres hablar con una persona del equipo? Responde Sí o No.";
export const OFERTA_BOTONES = ["Sí", "No"];
export const OFERTA_NO_ACK = "Perfecto, sigo por aquí. ¿En qué más te ayudo?";

/** El Sí/No a la oferta; null si el mensaje dice otra cosa y sigue el bot. */
export function respuestaAOferta(text: string | null): "si" | "no" | null {
  const t = (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z ]/gi, "")
    .trim()
    .toLowerCase();
  if (/^(si|claro|dale)( por favor| quiero)?$/.test(t)) return "si";
  if (/^no( gracias)?$/.test(t)) return "no";
  return null;
}
