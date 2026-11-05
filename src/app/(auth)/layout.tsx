import { isInstanceBrand } from "@/lib/brand";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";
import { BrandLogo } from "@/components/brand-mark";

/**
 * La puerta de entrada de la plataforma: foto de oficina a la izquierda con la
 * propuesta de valor encima, formulario a la derecha.
 *
 * La mitad izquierda lleva `.nav-dark`, la misma paleta azul marino de la barra
 * lateral: es lo que hace que el texto claro se lea sobre la foto sin escribir
 * un solo color literal (regla 1 de `tailwind.config.ts`). En teléfono la foto
 * desaparece y queda el formulario a pantalla completa.
 *
 * Quien mira todavía no tiene sesión, así que la marca es la de la PLATAFORMA
 * (`getBranding()` sin organización). Un espacio white-label que cierre el
 * registro ve su nombre y su descripción aquí, no el lema de RAE.
 */
const VENTAJAS = [
  { title: "Clientes organizados", text: "Un solo lugar para cada conversación, cada contacto y cada venta." },
  { title: "Canales conectados", text: "WhatsApp, Instagram y Facebook atendidos desde la misma bandeja." },
  { title: "Gestión inteligente", text: "Un agente de IA que responde, agenda y sabe lo que tienes en stock." },
];

export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  const instance = isInstanceBrand(branding.name);

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-subtle lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:flex-row">
      <section className="nav-dark auth-photo relative hidden flex-col justify-between px-10 py-9 lg:flex">
        <div>
          <BrandLogo branding={branding} size="lg" multiline />
        </div>

        <div className="max-w-xl">
          <h1 className="text-[40px] font-bold leading-[1.06] tracking-[-0.03em] xl:text-[46px]">
            {instance ? (
              <>
                Todo tu negocio.
                <br />
                Un solo lugar.
                <br />
                Más posibilidades.
              </>
            ) : (
              branding.name
            )}
          </h1>
          <p className="mt-4 text-[17px] leading-snug text-text-2">
            {instance
              ? `Conecta tus canales, organiza tus clientes y gestiona tu negocio desde ${branding.name} CRM.`
              : branding.description || "CRM de WhatsApp con agente de IA."}
          </p>

          {instance && (
            <ul className="mt-8 grid gap-4 sm:grid-cols-3">
              {VENTAJAS.map((v) => (
                <li key={v.title} className="flex flex-col gap-1">
                  <span className="text-[14px] font-semibold">{v.title}</span>
                  <span className="text-[12.5px] leading-snug text-text-3">
                    {v.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="kicker text-text-3">
          {instance ? "Ideas | Estrategia | Resultados" : branding.name}
        </p>
      </section>

      <div className="relative flex min-h-dvh flex-col items-center justify-center gap-4 px-4 py-8 sm:px-6">
        <div className="w-full max-w-[420px]">
          {/* En teléfono no hay foto: la marca se recuerda arriba del formulario. */}
          <div className="mb-6 flex justify-center lg:hidden">
            <BrandLogo branding={branding} size="lg" />
          </div>
          {children}
        </div>
        <p className="text-[12.5px] text-text-3">© {branding.name}</p>
      </div>
    </main>
  );
}
