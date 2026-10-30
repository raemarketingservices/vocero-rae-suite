import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Iniciales (máx 2) para el avatar de un contacto. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

/* Paleta de los avatares del mockup de la landing (hsl(h 62% 52%)): tonos
   medios saturados, legibles con inicial blanca en los dos temas. */
const AVATAR_COLORS = [
  "bg-[#3985d1]", // azul
  "bg-[#d17139]", // terracota
  "bg-[#9e39d1]", // violeta
  "bg-[#30a657]", // verde
  "bg-[#ce3b6c]", // frambuesa
  "bg-[#b67c20]", // ámbar
  "bg-[#30a6a6]", // turquesa
  "bg-[#6954d4]", // índigo
] as const;

/** Color estable por contacto: hash simple del id/teléfono → misma clase siempre. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

export function formatPhone(phone: string | null | undefined): string {
  // 003: contactos BSUID pueden no tener teléfono.
  return phone ? `+${phone}` : "Sin teléfono";
}

/**
 * El fallo y su pista juntos. El `message` lo escribe el proveedor y dice qué
 * pasó en su idioma; la `hint` la pone la API cuando hay algo que el operador
 * pueda hacer al respecto. Sin pista se muestra el mensaje a secas.
 */
export function conHint(message: string, hint?: string | null): string {
  return hint ? `${message} — ${hint}` : message;
}
