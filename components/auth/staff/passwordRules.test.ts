import { describe, expect, it } from "vitest";
import { newPasswordProblems, passwordMessage, summaryTitle } from "./passwordRules";

const IDS = { password: "p", confirm: "c" };

describe("passwordMessage", () => {
  it("pide 10 caracteres como mínimo y dice cuántos faltan", () => {
    expect(passwordMessage("")).toMatch(/Escribí/);
    expect(passwordMessage("123456789")).toMatch(/Le faltan 1 caracteres/);
    expect(passwordMessage("1234567890")).toBeNull();
  });

  it("no pasa de 72, el límite de bcrypt", () => {
    expect(passwordMessage("a".repeat(72))).toBeNull();
    expect(passwordMessage("a".repeat(73))).toMatch(/72/);
  });
});

describe("newPasswordProblems", () => {
  it("pide la confirmación cuando la contraseña ya sirve", () => {
    expect(newPasswordProblems("una frase larga", "", IDS)).toEqual([{ field: "c", message: "Repetí la contraseña para confirmarla." }]);
    expect(newPasswordProblems("una frase larga", "otra frase larga", IDS)).toEqual([{ field: "c", message: "Las dos contraseñas no son iguales." }]);
    expect(newPasswordProblems("una frase larga", "una frase larga", IDS)).toEqual([]);
  });

  it("una contraseña corta no se compara todavía con la confirmación", () => {
    expect(newPasswordProblems("corta", "otra", IDS)).toHaveLength(1);
  });

  it("el título cuenta lo que hay para revisar", () => {
    expect(summaryTitle(1)).toBe("Hay un dato para revisar");
    expect(summaryTitle(2)).toBe("Hay 2 datos para revisar");
  });
});
