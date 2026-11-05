import { BrandingClient } from "@/components/settings/branding-client";
import { getBranding } from "@/server/branding";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  // La marca se lee en el servidor para que el formulario y la tarjeta del
  // icono ya pinten la vista previa correcta en el primer render, sin un
  // parpadeo del generado al subido mientras un fetch del cliente va y vuelve.
  const session = await getSessionOrNull();
  const branding = await getBranding(session?.organizationId);

  return <BrandingClient branding={branding} />;
}
