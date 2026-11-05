import { getPlatformBranding } from "@/server/platform-branding";
import { MarcaPlataforma } from "@/components/panel/marca-plataforma";

export const dynamic = "force-dynamic";

/**
 * La marca del cascarón de la plataforma. El `layout` del panel ya rechazó al
 * que no está en `PLATFORM_ADMIN_EMAILS`, así que aquí se puede leer y escribir
 * la marca global sin preguntar más.
 */
export default async function PanelMarcaPage() {
  return <MarcaPlataforma branding={await getPlatformBranding()} />;
}
