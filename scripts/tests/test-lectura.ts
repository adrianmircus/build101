// Pruebas sin IA de la notación de química (mhchem): cómo se lee en voz alta («Escuchar») y que el control de números
// no la confunda con un dato cambiado.
// Correr con: npx tsx scripts/tests/test-lectura.ts
import { checkNumbers } from "../../lib/groups/numberCheck";
import type { Version } from "../../lib/groups/types";
import { speechText } from "../../lib/speech/latexSpeech";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${name}${pass ? "" : `\n      esperado ${JSON.stringify(want)}\n      obtenido ${JSON.stringify(got)}`}`);
}

// Matemática: lo que ya se leía así antes de sumar química.
check("matemática: fracción", speechText("$\\frac{x^2-4}{x-2}$"), "equis al cuadrado menos 4, sobre equis menos 2");
check("matemática: función", speechText("$f(x) = 3x^2 + 2x - 1$"), "efe de equis igual a 3 equis al cuadrado más 2 equis menos 1");
check("matemática: todo al cuadrado", speechText("$(x-1)^2$"), "equis menos 1, todo al cuadrado");
check("matemática: raíz", speechText("$\\sqrt{x+1} = 3$"), "raíz cuadrada de equis más 1 igual a 3");
check("matemática: valor absoluto", speechText("Resolvé en $\\mathbb{R}$: $|x-2| < 5$"), "Resolvé en los reales: valor absoluto de equis menos 2, menor que 5");

// Química con \ce: los símbolos se deletrean y los números quedan en cifras.
check("química: agua", speechText("$\\ce{H2O}$"), "hache 2 o");
check("química: ecuación", speechText("$\\ce{2H2 + O2 -> 2H2O}$"), "2 hache 2 más o 2, produce, 2 hache 2 o");
check("química: ion con ^", speechText("$\\ce{SO4^2-}$"), "ese o 4, 2 menos");
check("química: iones sin ^", speechText("$\\ce{Na+ + Cl- -> NaCl}$"), "ene a más, más ce ele menos, produce, ene a ce ele");
check("química: equilibrio", speechText("$\\ce{N2 + 3H2 <=> 2NH3}$"), "ene 2 más 3 hache 2, en equilibrio con, 2 ene hache 3");
check(
  "química: estados",
  speechText("$\\ce{NaCl(s) -> Na+(aq) + Cl-(aq)}$"),
  "ene a ce ele sólido, produce, ene a más, acuoso más ce ele menos, acuoso",
);
check("química: paréntesis", speechText("$\\ce{Ca(OH)2}$"), "ce a, o hache, 2");
check("química: enlace", speechText("$\\ce{CH3-CH3}$"), "ce hache 3, ce hache 3");

// Unidades con \pu.
check("unidades: aceleración", speechText("$\\pu{9.8 m/s^2}$"), "9 coma 8 metros por segundo al cuadrado");
check("unidades: singular", speechText("$\\pu{1 mol}$"), "1 mol");
check("unidades: negativo", speechText("$\\pu{-285.8 kJ/mol}$"), "menos 285 coma 8 kilojoules por mol");
check("unidades: grados", speechText("$\\pu{25 °C}$"), "25 grados Celsius");
check("unidades: en una frase", speechText("La masa es $m = \\pu{2 kg}$ y $F = m \\cdot a$"), "La masa es eme igual a 2 kilogramos y efe igual a eme por a");

// Control de números: el original escrito a mano con subíndices y la versión en LaTeX tienen los mismos datos.
const issues = (original: string, content: string) => {
  const version: Version = { profiles: ["tdah"], studentIds: [], status: "ready", content, approved: false };
  const check = checkNumbers(original, version);
  return check.applies ? check.issues : null;
};
check("números: H₂O es \\ce{H2O}", issues("1) Calculá la masa de 3 mol de H₂O", "1) Calculá la masa de 3 mol de $\\ce{H2O}$"), []);
check("números: m/s² es \\pu{m/s^2}", issues("1) Un auto acelera a 2,5 m/s²", "1) Un auto acelera a $\\pu{2.5 m/s^2}$"), []);
check("números: x² es x^2", issues("1) Resolvé x² = 9", "1) Resolvé $x^2 = 9$"), []);
check(
  "números: un dato cambiado se sigue viendo",
  issues("1) Calculá la masa de 3 mol de H₂O", "1) Calculá la masa de 4 mol de $\\ce{H2O}$"),
  [{ exercise: 1, missing: ["3"], added: ["4"], absent: false }],
);

console.log(failed === 0 ? "\nTodo pasa." : `\n${failed} pruebas fallan.`);
process.exit(failed === 0 ? 0 : 1);
