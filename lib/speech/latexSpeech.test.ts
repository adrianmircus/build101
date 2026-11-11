// Pruebas sin IA de la notación de química (mhchem): cómo se lee en voz alta («Escuchar») y que el control de números
// no la confunda con un dato cambiado.
import { expect, it } from "vitest";
import { checkNumbers } from "@/lib/groups/numberCheck";
import type { Version } from "@/lib/groups/types";
import { speechText } from "@/lib/speech/latexSpeech";

// Matemática: lo que ya se leía así antes de sumar química.
it("matemática: fracción", () => {
  expect(speechText("$\\frac{x^2-4}{x-2}$")).toEqual("equis al cuadrado menos 4, sobre equis menos 2");
});
it("matemática: función", () => {
  expect(speechText("$f(x) = 3x^2 + 2x - 1$")).toEqual("efe de equis igual a 3 equis al cuadrado más 2 equis menos 1");
});
it("matemática: todo al cuadrado", () => {
  expect(speechText("$(x-1)^2$")).toEqual("equis menos 1, todo al cuadrado");
});
it("matemática: raíz", () => {
  expect(speechText("$\\sqrt{x+1} = 3$")).toEqual("raíz cuadrada de equis más 1 igual a 3");
});
it("matemática: valor absoluto", () => {
  expect(speechText("Resolvé en $\\mathbb{R}$: $|x-2| < 5$")).toEqual("Resolvé en los reales: valor absoluto de equis menos 2, menor que 5");
});

// Química con \ce: los símbolos se deletrean y los números quedan en cifras.
it("química: agua", () => {
  expect(speechText("$\\ce{H2O}$")).toEqual("hache 2 o");
});
it("química: ecuación", () => {
  expect(speechText("$\\ce{2H2 + O2 -> 2H2O}$")).toEqual("2 hache 2 más o 2, produce, 2 hache 2 o");
});
it("química: ion con ^", () => {
  expect(speechText("$\\ce{SO4^2-}$")).toEqual("ese o 4, 2 menos");
});
it("química: iones sin ^", () => {
  expect(speechText("$\\ce{Na+ + Cl- -> NaCl}$")).toEqual("ene a más, más ce ele menos, produce, ene a ce ele");
});
it("química: equilibrio", () => {
  expect(speechText("$\\ce{N2 + 3H2 <=> 2NH3}$")).toEqual("ene 2 más 3 hache 2, en equilibrio con, 2 ene hache 3");
});
it("química: estados", () => {
  expect(speechText("$\\ce{NaCl(s) -> Na+(aq) + Cl-(aq)}$")).toEqual("ene a ce ele sólido, produce, ene a más, acuoso más ce ele menos, acuoso");
});
it("química: paréntesis", () => {
  expect(speechText("$\\ce{Ca(OH)2}$")).toEqual("ce a, o hache, 2");
});
it("química: enlace", () => {
  expect(speechText("$\\ce{CH3-CH3}$")).toEqual("ce hache 3, ce hache 3");
});

// Unidades con \pu.
it("unidades: aceleración", () => {
  expect(speechText("$\\pu{9.8 m/s^2}$")).toEqual("9 coma 8 metros por segundo al cuadrado");
});
it("unidades: singular", () => {
  expect(speechText("$\\pu{1 mol}$")).toEqual("1 mol");
});
it("unidades: negativo", () => {
  expect(speechText("$\\pu{-285.8 kJ/mol}$")).toEqual("menos 285 coma 8 kilojoules por mol");
});
it("unidades: grados", () => {
  expect(speechText("$\\pu{25 °C}$")).toEqual("25 grados Celsius");
});
it("unidades: en una frase", () => {
  expect(speechText("La masa es $m = \\pu{2 kg}$ y $F = m \\cdot a$")).toEqual("La masa es eme igual a 2 kilogramos y efe igual a eme por a");
});

// Control de números: el original escrito a mano con subíndices y la versión en LaTeX tienen los mismos datos.
const issues = (original: string, content: string) => {
  const version: Version = { profiles: ["tdah"], studentIds: [], status: "ready", content, approved: false };
  const check = checkNumbers(original, version);
  return check.applies ? check.issues : null;
};
it("números: H₂O es \\ce{H2O}", () => {
  expect(issues("1) Calculá la masa de 3 mol de H₂O", "1) Calculá la masa de 3 mol de $\\ce{H2O}$")).toEqual([]);
});
it("números: m/s² es \\pu{m/s^2}", () => {
  expect(issues("1) Un auto acelera a 2,5 m/s²", "1) Un auto acelera a $\\pu{2.5 m/s^2}$")).toEqual([]);
});
it("números: x² es x^2", () => {
  expect(issues("1) Resolvé x² = 9", "1) Resolvé $x^2 = 9$")).toEqual([]);
});
it("números: un dato cambiado se sigue viendo", () => {
  expect(issues("1) Calculá la masa de 3 mol de H₂O", "1) Calculá la masa de 4 mol de $\\ce{H2O}$")).toEqual([{ exercise: 1, missing: ["3"], added: ["4"], absent: false }]);
});
