import { describe, expect, it } from "vitest";
import {
  appNavGroups,
  isNavActive,
  SETTINGS_ITEM,
  settingsSections,
} from "@/lib/nav";

/**
 * #87 — El menú agrupado y Ajustes en tres secciones. Lo que aparece y lo
 * que no lo deciden las banderas (`AGENDA`, `CHANNELS`, `ATRIBUCION`) y el
 * rol; aquí se afirma sobre el modelo, sin dibujar nada.
 */

const labels = (groups: { items: { label: string }[] }[]) =>
  groups.map((g) => g.items.map((i) => i.label));

describe("barra lateral agrupada", () => {
  it("con todo apagado y como miembro: Trabajo, Agente y Resultados", () => {
    const groups = appNavGroups({ role: "member" });
    expect(groups.map((g) => g.title)).toEqual(["Trabajo", "Agente", undefined]);
    expect(labels(groups)).toEqual([
      ["Bandeja", "Pipeline", "Contactos"],
      ["Agente", "Laboratorio"],
      ["Resultados"],
    ]);
  });

  it("AGENDA añade Citas al final de Trabajo", () => {
    const [trabajo] = appNavGroups({ agenda: true, role: "member" });
    expect(trabajo!.items.map((i) => i.label)).toEqual([
      "Bandeja",
      "Pipeline",
      "Contactos",
      "Citas",
    ]);
    expect(trabajo!.items.at(-1)!.href).toBe("/bookings");
  });

  it("la guía de inicio abre el grupo Agente solo para quien configura", () => {
    for (const role of ["owner", "admin"]) {
      const agente = appNavGroups({ role })[1]!;
      expect(agente.items[0]).toMatchObject({ href: "/onboarding", label: "Guía de inicio" });
    }
    for (const role of ["member", null, undefined]) {
      const agente = appNavGroups({ role })[1]!;
      expect(agente.items.map((i) => i.href)).not.toContain("/onboarding");
    }
  });

  it("solo la Bandeja lleva el contador y Ajustes queda fuera de los grupos", () => {
    const todos = appNavGroups({ agenda: true, role: "owner" }).flatMap((g) => g.items);
    expect(todos.filter((i) => i.badge).map((i) => i.href)).toEqual(["/inbox"]);
    expect(todos.map((i) => i.href)).not.toContain("/settings");
    expect(SETTINGS_ITEM.href).toBe("/settings");
    // Cada entrada trae su icono: el renglón lo pinta sin condicionar.
    for (const item of [...todos, SETTINGS_ITEM]) expect(item.icon).toBeDefined();
  });

  it("una ruta hija activa su entrada, y /settings no activa nada más", () => {
    expect(isNavActive("/inbox/cv_123", "/inbox")).toBe(true);
    expect(isNavActive("/inbox", "/inbox")).toBe(true);
    expect(isNavActive("/inboxes", "/inbox")).toBe(false);
    expect(isNavActive("/settings/ai", "/settings")).toBe(true);
    expect(isNavActive("/settings/ai", "/agent")).toBe(false);
  });

  it("el panel de la plataforma solo existe si el servidor dice que lo es", () => {
    const hrefs = (groups: { items: { href: string }[] }[]) =>
      groups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs(appNavGroups({ role: "owner" }))).not.toContain("/panel");
    expect(hrefs(appNavGroups({ role: "member" }))).not.toContain("/panel");
    expect(hrefs(appNavGroups({ role: "owner", panel: true }))).toContain("/panel");
    // Va al final y con su propio encabezado: no es el trabajo del día.
    const grupos = appNavGroups({ role: "owner", panel: true });
    expect(grupos.at(-1)).toMatchObject({
      title: "Plataforma",
      items: [{ href: "/panel", label: "Panel" }],
    });
  });
});

describe("ajustes en tres secciones", () => {
  const links = (s: { title: string; links: { label: string }[] }[]) =>
    Object.fromEntries(s.map((x) => [x.title, x.links.map((l) => l.label)]));

  it("con todo apagado: Canales, Agente y Negocio con lo mínimo", () => {
    const sections = settingsSections({});
    expect(sections.map((s) => s.title)).toEqual(["Canales", "Agente", "Negocio"]);
    expect(links(sections)).toEqual({
      Canales: ["WhatsApp"],
      Agente: ["IA"],
      Negocio: ["Marca", "Plantillas", "Equipo"],
    });
  });

  it("cada bandera añade su enlace en su sección y en ninguna otra", () => {
    expect(links(settingsSections({ instagram: true }))).toEqual({
      Canales: ["WhatsApp", "Instagram"],
      Agente: ["IA"],
      Negocio: ["Marca", "Plantillas", "Equipo"],
    });
    expect(links(settingsSections({ messenger: true }))).toEqual({
      Canales: ["WhatsApp", "Messenger"],
      Agente: ["IA"],
      Negocio: ["Marca", "Plantillas", "Equipo"],
    });
    expect(links(settingsSections({ agenda: true }))).toEqual({
      Canales: ["WhatsApp"],
      Agente: ["IA", "Agenda"],
      Negocio: ["Marca", "Plantillas", "Equipo"],
    });
    expect(links(settingsSections({ atribucion: true }))).toEqual({
      Canales: ["WhatsApp"],
      Agente: ["IA"],
      Negocio: ["Marca", "Plantillas", "Equipo", "Anuncios"],
    });
  });

  it("con todo encendido, cada pantalla de Ajustes tiene exactamente un enlace", () => {
    const all = settingsSections({
      agenda: true,
      atribucion: true,
      instagram: true,
      messenger: true,
    })
      .flatMap((s) => s.links)
      .map((l) => l.href);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(
      [
        "/settings/whatsapp",
        "/settings/instagram",
        "/settings/messenger",
        "/settings/ai",
        "/settings/calendar",
        "/settings/branding",
        "/settings/templates",
        "/settings/team",
        "/settings/ads",
      ].sort()
    );
  });

  it("el Laboratorio no está en Ajustes: sigue en el menú principal", () => {
    const hrefs = settingsSections({
      agenda: true,
      atribucion: true,
      instagram: true,
      messenger: true,
    })
      .flatMap((s) => s.links)
      .map((l) => l.href);
    expect(hrefs).not.toContain("/lab");
    expect(appNavGroups({ role: "owner" }).flatMap((g) => g.items).map((i) => i.href)).toContain("/lab");
  });
});
