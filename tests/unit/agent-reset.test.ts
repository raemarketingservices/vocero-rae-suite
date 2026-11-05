import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/agent/profile/reset`: el botón «Restablecer agente» de la pantalla
 * Agente. Deja el perfil como recién sembrado —apagado y sin nombre, tono,
 * instrucciones, reglas de escalado ni saludo— y no toca la knowledge base.
 */

const last = vi.hoisted(() => ({ set: null as Record<string, unknown> | null }));
const filas = vi.hoisted(() => ({ actualizado: true }));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({
    userId: "usr_1",
    organizationId: "org_a",
    role: "owner",
  }),
  getSessionOrNull: async () => ({
    userId: "usr_1",
    organizationId: "org_a",
    role: "owner",
  }),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  builder.update = () => builder;
  builder.set = (values: Record<string, unknown>) => {
    last.set = values;
    return builder;
  };
  builder.where = () => builder;
  builder.returning = () =>
    Promise.resolve(filas.actualizado ? [{ id: "ap_1" }] : []);
  return { ...actual, getDb: () => builder };
});

import { POST } from "@/app/api/agent/profile/reset/route";

beforeEach(() => {
  last.set = null;
  filas.actualizado = true;
});

describe("POST /api/agent/profile/reset", () => {
  it("apaga el agente y deja sus campos en blanco", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(last.set).toMatchObject({
      enabled: false,
      name: "Asistente",
      tone: null,
      instructions: null,
      escalationRules: null,
      greeting: null,
    });
    expect(last.set?.updatedAt).toBeInstanceOf(Date);
  });

  it("404 si la organización no tiene perfil", async () => {
    filas.actualizado = false;
    const res = await POST();
    expect(res.status).toBe(404);
  });
});
