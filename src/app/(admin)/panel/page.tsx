import { listarTiendas } from "@/server/platform/resumen";
import { inventarioUnikoActivo } from "@/server/uniko/config";
import { TiendasTablero } from "@/components/panel/tiendas-tablero";

export const dynamic = "force-dynamic";

/**
 * Las tiendas de la instancia, de una ojeada: quién es el dueño, cuánto se le
 * escribe, y qué canales y agente funcionan.
 *
 * Se pinta por tarjeta y no por tabla: lo que se mira no es un número sino el
 * ESTADO de cada tienda, y en una tabla de siete columnas un `reconnect_required`
 * a las tres tiendas se vuelve un texto más. Cada bicho tiene su color, y las
 * cuatro cifras de arriba cuentan lo que hay que saber sin bajar de la página.
 */
export default async function PanelTiendasPage() {
  const tiendas = await listarTiendas();
  // Sin URL ni llave anon en el despliegue, la superficie de catálogo no
  // existe: ni la fila se pinta (la ruta también responde 404).
  return (
    <TiendasTablero tiendas={tiendas} conCatalogo={inventarioUnikoActivo()} />
  );
}
