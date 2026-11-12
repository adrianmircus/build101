import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/ingresar/estudiante/actions", () => ({
  findInstitutionAction: vi.fn(),
  signInStudentAction: vi.fn(),
  readAccessCardAction: vi.fn(),
}));

const { StudentLogin } = await import("./StudentLogin");
const { expectNoRed, markup } = await import("./testing");

const school = { code: "sanjose", name: "Colegio San José" };

describe("StudentLogin (primer dibujo)", () => {
  it("sin colegio recordado pide los tres datos", () => {
    const html = markup(createElement(StudentLogin, { remembered: null }));
    expect(html).toContain("Código del colegio");
    expect(html).toContain("Copiá los tres datos tal como están en la tarjeta.");
    expectNoRed(html);
  });

  it("con colegio recordado pide dos y dice cuál es", () => {
    const html = markup(createElement(StudentLogin, { remembered: school }));
    expect(html).not.toContain("Código del colegio");
    expect(html).toContain("Colegio San José");
    expect(html).toContain("Copiá tu usuario y tu contraseña.");
  });

  it("con una tarjeta pone colegio y usuario, y deja la contraseña", () => {
    const html = markup(createElement(StudentLogin, { remembered: null, card: { ...school, username: "luciaf" } }));
    expect(html).toContain("Colegio San José");
    expect(html).toContain("Usuario luciaf");
    expect(html).toContain("Escribí la contraseña que está en la tarjeta.");
    expect(html).not.toContain("Código del colegio");
    expect(html).toContain('autoComplete="current-password"');
  });
});
