import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  esAdminDePlataforma,
  hayAdminDePlataforma,
  parseAdminEmails,
} from "@/lib/auth/platform";

/**
 * El admin de la plataforma es la única puerta entre RAE y los datos de todos
 * sus clientes. Lo que importa aquí es el DEFAULT (sin variable, nadie es
 * admin) y que la lista no se trague basura: un `PLATFORM_ADMIN_EMAILS=" "` no
 * puede abrir el panel a todo el mundo.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
let anterior: string | undefined;

beforeEach(() => {
  anterior = process.env.PLATFORM_ADMIN_EMAILS;
});

afterEach(() => {
  if (anterior === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = anterior;
});

describe("parseAdminEmails", () => {
  it("sin variable no hay nadie", () => {
    expect(parseAdminEmails(undefined).size).toBe(0);
    expect(parseAdminEmails("").size).toBe(0);
    expect(parseAdminEmails(" , ,").size).toBe(0);
  });

  it("separa por coma, quita espacios y baja las mayúsculas", () => {
    expect([...parseAdminEmails(" A@x.com , b@X.com ")]).toEqual(["a@x.com", "b@x.com"]);
  });
});

describe("esAdminDePlataforma", () => {
  it("el correo de la lista manda, sin importar mayúsculas ni espacios", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "Rae@Uniko-RD.com";
    expect(esAdminDePlataforma("rae@uniko-rd.com")).toBe(true);
    expect(esAdminDePlataforma("  RAE@uniko-rd.COM  ")).toBe(true);
  });

  it("cualquier otro correo, no", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "rae@uniko-rd.com";
    expect(esAdminDePlataforma("cliente@otro.com")).toBe(false);
    expect(esAdminDePlataforma("rae@uniko-rd.com.es")).toBe(false);
    expect(esAdminDePlataforma(null)).toBe(false);
    expect(esAdminDePlataforma(undefined)).toBe(false);
    expect(esAdminDePlataforma("")).toBe(false);
  });

  it("con la variable vacía el panel se cierra para todos, incluido el vacío", () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(hayAdminDePlataforma()).toBe(false);
    expect(esAdminDePlataforma("rae@uniko-rd.com")).toBe(false);
    process.env.PLATFORM_ADMIN_EMAILS = "rae@uniko-rd.com";
    expect(hayAdminDePlataforma()).toBe(true);
  });
});

describe("la cookie de gestión no es una llave", () => {
  it("orgEnGestion() pregunta el correo ANTES de leer la cookie", () => {
    // El orden es todo: si se leyera la cookie primero, un cliente que se la
    // invente tendría su organización resuelta antes del filtro.
    const fuente = readFileSync(
      path.join(RAIZ, "src", "lib", "auth", "platform.ts"),
      "utf8"
    );
    const cuerpo = fuente.slice(fuente.indexOf("export async function orgEnGestion"));
    expect(cuerpo).toContain("esAdminDePlataforma(email)");
    expect(cuerpo.indexOf("esAdminDePlataforma(email)")).toBeLessThan(
      cuerpo.indexOf("COOKIE_GESTION")
    );
  });

  it("requireSession() no cae a la tienda de la cookie por su cuenta", () => {
    const fuente = readFileSync(
      path.join(RAIZ, "src", "lib", "auth", "session.ts"),
      "utf8"
    );
    // La única forma de cambiar de tienda es orgEnGestion(), que filtra.
    expect(fuente).toContain("orgEnGestion(session.user.email)");
    expect(fuente).not.toMatch(/cookies\(\)/);
  });

  it("las rutas del panel pasan por withPanel, no por withAuth", () => {
    const ruta = readFileSync(
      path.join(RAIZ, "src", "app", "api", "panel", "gestion", "route.ts"),
      "utf8"
    );
    expect(ruta).toContain("withPanel");
    expect(ruta).not.toContain("withAuth");
  });
});
