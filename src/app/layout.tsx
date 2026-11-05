import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, Montserrat, Yellowtail } from "next/font/google";
import { accentCssVariables, DEFAULT_BRANDING } from "@/lib/branding";
import { faviconHref } from "@/lib/favicon";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { brandingDePeticion } from "@/server/branding";
import "./globals.css";

// Las tres voces de la marca RAE: Montserrat para la interfaz (la principal
// de su guía de estilo), la script del logo para los acentos editoriales e
// IBM Plex Mono para etiquetas y horas. next/font las descarga en BUILD y las
// sirve self-hosted (sin CDN en runtime: soberanía).
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const brandScript = Yellowtail({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-serif",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const dynamic = "force-dynamic";

/**
 * La marca de QUIEN MIRA. Con sesión es la de su tienda —el acento, el nombre,
 * el logo y la descripción que puso en Configuración → Marca—; sin sesión es la
 * de la plataforma. Es la marca de la propia sesión y nada más: un cliente no
 * ve la cara de otro, y el login sigue siendo de RAE para todos.
 *
 * Si el entorno falla (base de datos en el aire durante un arranque) queda la
 * marca del código: una página pública sin pintar vale más que un 500.
 */
async function marcaDePagina() {
  try {
    return (await brandingDePeticion()).branding;
  } catch {
    return DEFAULT_BRANDING;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const branding = await marcaDePagina();
  return {
    title: `${branding.name} — Suite CRM de WhatsApp`,
    description: branding.description || DEFAULT_BRANDING.description,
    // El `?v=` cambia con la marca: los navegadores guardan el favicon con una
    // insistencia notable y, sin eso, el logo nuevo tarda días en aparecer.
    icons: { icon: faviconHref(branding) },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await marcaDePagina();
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );
  return (
    <html
      lang="es"
      className={`${montserrat.variable} ${brandScript.variable} ${plexMono.variable}`}
      // La preferencia siempre es explícita: el tema viaja resuelto en el HTML
      // del servidor, así que no hay divergencia con el cliente ni parpadeo.
      data-theme={theme}
    >
      <head>
        {/* Acento white-label inyectado en SSR: sin flash de tema */}
        <style
          dangerouslySetInnerHTML={{ __html: accentCssVariables(branding.accent) }}
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
