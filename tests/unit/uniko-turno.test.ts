import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** El bloque del turno: perfil + coincidencias, o perfil + muestra si no hay. */

vi.mock("@/server/platform/vinculo", () => ({
  storeIdDeTienda: async () => "tech-rd",
}));

import { bloqueDeExistenciasParaTurno } from "@/server/uniko/turno";

const respuesta = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (String(url).includes("/rest/v1/stores")) {
    return respuesta([{ id: "tech-rd", name: "Tech RD", description: "Celulares" }]);
  }
  const q = JSON.parse(String(init?.body)).p_query as string;
  const p = { id: "p1", title: "iPhone 15", price: 52000, tracks_stock: true, stock: 4, available: true };
  return respuesta({ products: !q || q.includes("iphone") ? [p] : [] });
});

beforeEach(() => {
  process.env.UNIKO_SUPABASE_URL = "http://uniko.test";
  process.env.UNIKO_SUPABASE_ANON_KEY = "anon";
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UNIKO_SUPABASE_URL;
  delete process.env.UNIKO_SUPABASE_ANON_KEY;
});

it("con coincidencia: perfil + existencias", async () => {
  const b = await bloqueDeExistenciasParaTurno("org_1", "tienen iphone?");
  expect(b).toContain("PERFIL DE ESTE NEGOCIO EN UNIKO-RD");
  expect(b).toContain("EXISTENCIAS EN ESTE INSTANTE");
  expect(b).toContain("iPhone 15");
});

it("sin coincidencia: perfil + muestra del catálogo", async () => {
  const b = await bloqueDeExistenciasParaTurno("org_1", "qué venden?");
  expect(b).toContain("ALGUNOS PRODUCTOS DEL CATÁLOGO");
  expect(b).toContain("iPhone 15");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
