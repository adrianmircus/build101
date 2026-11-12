import { describe, expect, it } from "vitest";
import { DECOY_EMAIL, isSyntheticEmail, normalizeEmail, randomPartFromEmail, studentEmail } from "./email";

const PART = "3f1c2d4e5a6b4c7d8e9f0a1b2c3d4e5f";

describe("synthetic email", () => {
  it("builds and recognizes the address from a random part", () => {
    expect(studentEmail(PART)).toBe(`${PART}@estudiantes.usetiza.app`);
    expect(randomPartFromEmail(studentEmail(PART))).toBe(PART);
  });

  it("lower-cases the part and ignores case and spaces when reading", () => {
    expect(studentEmail(PART.toUpperCase())).toBe(`${PART}@estudiantes.usetiza.app`);
    expect(randomPartFromEmail(`  ${PART.toUpperCase()}@Estudiantes.Usetiza.App `)).toBe(PART);
  });

  it("refuses what is not 32 hex characters", () => {
    expect(() => studentEmail("lucia")).toThrow();
    expect(() => studentEmail("3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f")).toThrow();
    expect(randomPartFromEmail("lucia@estudiantes.usetiza.app")).toBeNull();
    expect(randomPartFromEmail(`${PART}@otro.example`)).toBeNull();
    expect(randomPartFromEmail(`${PART}@estudiantes.usetiza.app@x`)).toBeNull();
    expect(randomPartFromEmail("sin-arroba")).toBeNull();
  });

  it("keeps the decoy inside the synthetic domain but never as a student", () => {
    expect(isSyntheticEmail(DECOY_EMAIL)).toBe(true);
    expect(randomPartFromEmail(DECOY_EMAIL)).toBeNull();
  });

  it("flags every address of the domain, even a malformed one", () => {
    expect(isSyntheticEmail(studentEmail(PART))).toBe(true);
    expect(isSyntheticEmail(" Cualquiera@ESTUDIANTES.usetiza.app ")).toBe(true);
    expect(isSyntheticEmail("profe@usetiza.app")).toBe(false);
    expect(isSyntheticEmail("a@mi-estudiantes.usetiza.app")).toBe(false);
  });

  it("normalizes a staff email", () => {
    expect(normalizeEmail("  Profe@Colegio.EDU.uy ")).toBe("profe@colegio.edu.uy");
  });
});
