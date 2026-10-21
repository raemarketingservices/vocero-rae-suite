import { isInstanceBrand } from "@/lib/brand";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";
import { BrandLogo } from "@/components/brand-mark";

/**
 * Pantalla de entrada de la plataforma: papel gris claro, rejilla difuminada
 * y dos resplandores (azul principal y azul claro) detrás del formulario. Con
 * la marca de la instancia se remata con el lema de RAE; un espacio white-label
 * ve su nombre y una descripción neutra.
 */
export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  const instance = isInstanceBrand(branding.name);
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-subtle p-4">
      <div className="brand-grid absolute inset-0" aria-hidden />
      <div className="brand-glow brand-glow-a" aria-hidden />
      <div className="brand-glow brand-glow-b" aria-hidden />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <BrandLogo branding={branding} size="lg" />
          {instance ? (
            <div className="space-y-2">
              <p className="kicker">Ideas | Estrategia | Resultados</p>
              <h1 className="text-[22px] font-bold leading-tight tracking-[-0.03em]">
                Tu crecimiento,{" "}
                <span
                  className="bg-clip-text font-serif text-[1.22em] font-normal tracking-[-0.01em] text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(92deg, var(--accent) 12%, #4ea1ff 88%)",
                  }}
                >
                  nuestra pasión.
                </span>
              </h1>
            </div>
          ) : (
            <div>
              <h1 className="sr-only">{branding.name}</h1>
              <p className="text-sm text-text-3">CRM de WhatsApp con agente de IA</p>
            </div>
          )}
        </div>
        {children}
      </div>
    </main>
  );
}
