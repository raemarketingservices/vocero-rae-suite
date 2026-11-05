import { listarUsuarios } from "@/server/platform/resumen";
import { CuentasTabla } from "@/components/panel/cuentas-tabla";

export const dynamic = "force-dynamic";

/**
 * Todas las cuentas de la instancia, con las tiendas a las que pertenecen.
 * Es lo que responde a «¿quién hay dado de alta y en qué negocio mete las
 * narices?».
 */
export default async function PanelCuentasPage() {
  return <CuentasTabla usuarios={await listarUsuarios()} />;
}
