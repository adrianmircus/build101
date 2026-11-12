import { describe, expect, it } from "vitest";
import { revealWarnings, revealsSolution } from "./reveal";

// Advisory only: these produce warnings for the teacher, never a failed leak test.
describe("revealsSolution", () => {
  it("warns about a solution stated with Markdown emphasis", () => {
    expect(revealsSolution("Respuesta correcta: **A**", ["A"])).toBe(true);
  });

  it("warns about a solution stated with an article", () => {
    expect(revealsSolution("La respuesta correcta es la A", ["A"])).toBe(true);
  });

  it("warns in labels and option texts too", () => {
    expect(revealsSolution("Clave: A", ["A"])).toBe(true);
    expect(revealsSolution("Solución: x = 1", ["x = 1"])).toBe(true);
  });

  it("does not take part of a number for the value", () => {
    expect(revealsSolution("La respuesta es 1/2", ["1"])).toBe(false);
    expect(revealsSolution("La respuesta es 1,5", ["1"])).toBe(false);
  });

  it("does not warn when the value is not introduced as the solution", () => {
    expect(revealsSolution("Calculá la respuesta a la pregunta 1", ["A", "1"])).toBe(false);
    expect(revealsSolution("1", ["1"])).toBe(false);
  });
});

describe("revealWarnings", () => {
  it("returns the paths of the texts to look at", () => {
    const texts = [
      { path: "exercises.0.body", text: "Resolvé x + 1 = 2" },
      { path: "questions.0.options.0.text", text: "Clave: A" },
    ];
    expect(revealWarnings(texts, ["A"])).toEqual(["questions.0.options.0.text"]);
  });
});
