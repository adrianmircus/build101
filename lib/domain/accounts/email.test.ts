import { describe, expect, it } from "vitest";
import { isSyntheticEmail, normalizeEmail, studentEmail, authUserIdFromEmail } from "./email";

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

describe("synthetic email", () => {
  it("builds and recognizes the address of an Auth account", () => {
    expect(studentEmail(ID)).toBe(`${ID}@estudiantes.usetiza.app`);
    expect(authUserIdFromEmail(studentEmail(ID))).toBe(ID);
  });

  it("lower-cases the id and ignores case and spaces when reading", () => {
    expect(studentEmail(ID.toUpperCase())).toBe(`${ID}@estudiantes.usetiza.app`);
    expect(authUserIdFromEmail(`  ${ID.toUpperCase()}@Estudiantes.Usetiza.App `)).toBe(ID);
  });

  it("refuses what is not an id", () => {
    expect(() => studentEmail("lucia")).toThrow();
    expect(authUserIdFromEmail("lucia@estudiantes.usetiza.app")).toBeNull();
    expect(authUserIdFromEmail(`${ID}@otro.example`)).toBeNull();
    expect(authUserIdFromEmail(`${ID}@estudiantes.usetiza.app@x`)).toBeNull();
    expect(authUserIdFromEmail("sin-arroba")).toBeNull();
  });

  it("flags every address of the domain, even a malformed one", () => {
    expect(isSyntheticEmail(studentEmail(ID))).toBe(true);
    expect(isSyntheticEmail(" Cualquiera@ESTUDIANTES.usetiza.app ")).toBe(true);
    expect(isSyntheticEmail("profe@usetiza.app")).toBe(false);
    expect(isSyntheticEmail("a@mi-estudiantes.usetiza.app")).toBe(false);
  });

  it("normalizes a staff email", () => {
    expect(normalizeEmail("  Profe@Colegio.EDU.uy ")).toBe("profe@colegio.edu.uy");
  });
});
