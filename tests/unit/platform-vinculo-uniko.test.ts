import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El vínculo organización ↔ tienda de UNIKO-RD.
 *
 * Lo que se cuida es la forma del id: `stores.id` en UNIKO es un SLUG de texto
 * (`tech-store-rd`, o `slugify(nombre)` + sufijo al azar cuando la crea la web).
 * Validar un UUID aquí —que es lo que hacía— rechazaba todas las tiendas reales
 * y dejaba el vínculo imposible de poner, con el bot contestando solo de su
 * knowledge base para siempre.
 */

const actualizaciones: Record<string, unknown>[] = [];
let filas: { id: string }[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: (v: Record<string, unknown>) => {
        actualizaciones.push(v);
        return {
          where: () => ({
            returning: () => Promise.resolve(filas.map((f) => ({ ...f, ...v }))),
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(filas.map(() => ({ storeId: null }))),
        }),
      }),
    }),
  }),
  schema: { organization: { id: "id", unikoStoreId: "uniko_store_id" } },
}));

const { ponerVinculoUniko, StoreIdInvalido, storeIdDeTienda } = await import(
  "@/server/platform/vinculo"
);

const ORG = "org_6ri3juspu8wd6q91oq61";

describe("vínculo con la tienda de UNIKO-RD", () => {
  beforeEach(() => {
    actualizaciones.length = 0;
    filas = [{ id: ORG }];
  });

  it("acepta el slug de las tiendas sembradas", async () => {
    const vinculo = await ponerVinculoUniko(ORG, "tech-store-rd");
    expect(vinculo).toEqual({ organizationId: ORG, storeId: "tech-store-rd" });
    expect(actualizaciones[0]).toMatchObject({ unikoStoreId: "tech-store-rd" });
  });

  it("acepta el slug con sufijo que genera la web al dar de alta", async () => {
    const vinculo = await ponerVinculoUniko(ORG, "bella-natural-a1b2c");
    expect(vinculo?.storeId).toBe("bella-natural-a1b2c");
  });

  it("recorta los espacios alrededor", async () => {
    const vinculo = await ponerVinculoUniko(ORG, "  urban-style-rd  ");
    expect(vinculo?.storeId).toBe("urban-style-rd");
  });

  it.each([
    "bella-natural-rd",
    "casa-bella-rd",
    "compu-center-sd",
    "deportes-rd",
    "hogar-total-rd",
    "supermercado-cibao",
    "tech-store-rd",
    "urban-style-rd",
  ])("acepta %s, que es un id real de la tabla stores", async (id) => {
    const vinculo = await ponerVinculoUniko(ORG, id);
    expect(vinculo?.storeId).toBe(id);
  });

  it.each([
    ["con espacios", "tech store rd"],
    ["con mayúsculas", "Tech-Store-RD"],
    ["con barra (path traversal)", "../../etc/passwd"],
    ["con comilla", "tech'--"],
    ["guión suelto", "-"],
    ["doble guión", "tech--store"],
    ["más de 64 caracteres", "a".repeat(65)],
  ])("rechaza un id %s", async (_etiqueta, id) => {
    await expect(ponerVinculoUniko(ORG, id)).rejects.toBeInstanceOf(
      StoreIdInvalido
    );
    expect(actualizaciones).toHaveLength(0);
  });

  it("vacío o null quita el vínculo sin error", async () => {
    expect((await ponerVinculoUniko(ORG, null))?.storeId).toBeNull();
    expect((await ponerVinculoUniko(ORG, "   "))?.storeId).toBeNull();
    expect(actualizaciones).toEqual([
      { unikoStoreId: null },
      { unikoStoreId: null },
    ]);
  });

  it("devuelve null si la organización no existe", async () => {
    filas = [];
    await expect(ponerVinculoUniko("org_inexistente", "tech-store-rd")).resolves.toBeNull();
  });

  it("storeIdDeTienda no lanza cuando la organización no tiene vínculo", async () => {
    filas = [];
    await expect(storeIdDeTienda(ORG)).resolves.toBeNull();
  });
});
