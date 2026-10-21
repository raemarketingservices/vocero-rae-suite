/**
 * Registro público de la plataforma multi-tenant: cada cuenta nueva es un
 * cliente con su propio espacio (organización, bot de WhatsApp, base de
 * conocimiento y marca). Por eso el registro está ABIERTO por defecto y lo
 * cierra la variable de escape ALLOW_SIGNUP=false (por ejemplo, mientras solo
 * opera el equipo interno). Las cuentas de equipo las crea el propietario
 * (bypass interno del gate) y no pasan por aquí.
 */
export async function isPublicSignupAllowed(): Promise<boolean> {
  return process.env.ALLOW_SIGNUP !== "false";
}
