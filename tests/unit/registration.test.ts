import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-tenant: el registro público está abierto por defecto (cada cuenta es
 * un cliente con su propio espacio) y lo cierra ALLOW_SIGNUP=false.
 */

import { isPublicSignupAllowed } from "@/server/auth/registration";

afterEach(() => vi.unstubAllEnvs());

describe("registro público abierto (multi-tenant)", () => {
  it("sin variable de escape → permitido", async () => {
    vi.stubEnv("ALLOW_SIGNUP", "");
    expect(await isPublicSignupAllowed()).toBe(true);
  });

  it("ALLOW_SIGNUP=false → cerrado", async () => {
    vi.stubEnv("ALLOW_SIGNUP", "false");
    expect(await isPublicSignupAllowed()).toBe(false);
  });

  it("ALLOW_SIGNUP=true → permitido", async () => {
    vi.stubEnv("ALLOW_SIGNUP", "true");
    expect(await isPublicSignupAllowed()).toBe(true);
  });

  it("otros valores NO cierran el registro", async () => {
    vi.stubEnv("ALLOW_SIGNUP", "0");
    expect(await isPublicSignupAllowed()).toBe(true);
  });
});
