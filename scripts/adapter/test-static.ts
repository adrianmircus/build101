// Pruebas sin IA de la verificación, la legibilidad y la lectura en voz alta. Correr con: npx tsx scripts/test-static.ts
import fs from "node:fs";
import path from "node:path";
import { staticIssues, numbersIn, hintIssues, headerIssues, textReadability, mainExercises, scopeIssue, MAX_EXERCISES, MAX_ITEMS } from "../../lib/adapter/verify";
import { MAX_BYTES, uploadIssue } from "../../lib/adapter/upload";
import { normalize } from "../../lib/adapter/equivalence";
import { formulaAudio } from "../../lib/adapter/adapt-client";
import { syllables, readability } from "../../lib/adapter/readability";
import { speakMath } from "../../lib/adapter/speech";
import type { AdaptedItem, Item } from "../../lib/adapter/adapt-schemas";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${name}${pass ? "" : `\n      esperado ${JSON.stringify(want)}\n      obtenido ${JSON.stringify(got)}`}`);
}

check("sílabas aeroplano", syllables("aeroplano"), 5);
check("sílabas ciudad", syllables("ciudad"), 2);
check("sílabas día", syllables("día"), 2);
check("sílabas matemática", syllables("matemática"), 5);
const facil = "Resolvé la ecuación. Escribí el resultado. Mirá bien cada dato. Pensá qué se pide. Contestá con una frase corta.";
const dificil = "Resolver la siguiente ecuación de segundo grado utilizando la fórmula general correspondiente y verificar posteriormente el resultado obtenido.";
check("lectura fácil puntúa más alto", (readability(facil) ?? 0) > (readability(dificil) ?? 0), true);
check("legibilidad: con menos de 15 palabras no aplica", readability("Resolvé la ecuación. Escribí el resultado."), null);
check("legibilidad: casi todo fórmulas no aplica (antes daba 144)", textReadability(["Resolvé {{m1}}.", "Resolvé {{m2}} y {{m3}}.", "Hallá x en {{m4}}."]), null);
check("legibilidad: siempre entre 0 y 100", [readability("Ve a ver a la la. ".repeat(4)), readability(`${"Inconstitucionalidad ".repeat(20)}.`)], [100, 0]);
check("legibilidad: los marcadores no cuentan como palabras", textReadability(["Resolvé {{m1}} {{m2}} {{m3}} {{m4}} {{m5}} {{m6}} {{m7}} {{m8}} {{m9}} {{m10}} {{m11}} {{m12}} {{m13}} {{m14}}."]), null);

check("números en cifras y palabras", numbersIn("Ana compró 3 kilos y el doble de {{m2}} a 1,5 pesos"), [1.5, 2, 3]);
check("números: el signo cuenta", numbersIn("La temperatura bajó a -5 grados"), [-5]);
check("números: un guion entre cifras no es signo", numbersIn("páginas 3-4"), [3, 4]);
check("números: fracción en cifras igual a la palabra", numbersIn("la 1/2 del total"), numbersIn("la mitad del total"));
check("números: exponente", numbersIn("1e3 metros"), [1000]);
check("números: compuestos en palabras", numbersIn("treinta y dos estudiantes"), numbersIn("32 estudiantes"));
check("números: palabras que no son números", numbersIn("el constructor del edificio"), []);

check("voz: cuadrática", speakMath("x^2 - 5*x + 6 = 0"), "x al cuadrado menos 5 x más 6 igual a 0");
check("voz: fracción", speakMath("(x+1)/2 = 3"), "fracción: numerador x más 1, denominador 2, fin de la fracción igual a 3");
check("voz: raíz", speakMath("sqrt(x) = 4"), "raíz cuadrada de x igual a 4");

const orig: Item = {
  id: "3",
  kind: "problema",
  text: "Ana compró 3 kilos de manzanas y pagó 150 pesos. ¿Cuánto cuesta el kilo? Resolvé {{m4}}.",
  math: [{ id: "m4", mathjs: "3*p = 150", latex: "3p = 150", role: "equation" }],
  figure: "",
  unsure: false,
};
const good: AdaptedItem = { id: "3", text: "Ana compra 3 kilos de manzanas. Paga 150 pesos. Resolvé {{m4}}. ¿Cuánto cuesta un kilo?", steps: [], glossary: [], figure: "" };
check("adaptación correcta", staticIssues(orig, good, "lectura_facil"), []);
check("cambia un dato", staticIssues(orig, { ...good, text: good.text.replace("150", "160") }, "lectura_facil"), [
  "Falta el dato 150",
  "Aparece el número 160, que no está en el original",
]);
check("borra la expresión", staticIssues(orig, { ...good, text: good.text.replace(" Resolvé {{m4}}.", "") }, "lectura_facil"), ["Falta la expresión {{m4}}"]);
check("matemática suelta", staticIssues(orig, { ...good, text: good.text + " Pensá que 3 = 150 / p." }, "lectura_facil").includes("Hay matemática escrita fuera de los marcadores"), true);

// Piloto con bachillerato y revisión de Codex
check("voz: f(x) se lee f de x", speakMath("f(x) = 2*x + 3"), "f de x igual a 2 x más 3");
check("voz: P(x) mayúscula", speakMath("P(x) = x^2"), "P de x igual a x al cuadrado");
check("voz: log es en base 10", speakMath("log(4*x) = 3"), "logaritmo de 4 x igual a 3");
check("voz: ln es el neperiano", speakMath("ln(x) = 1"), "logaritmo neperiano de x igual a 1");
check("voz: log en base 2 con guion bajo", speakMath("log_2(8)"), "logaritmo en base 2 de 8");
check("voz: log con base como segundo argumento", speakMath("log(8, 2)"), "logaritmo en base 2 de 8");
check("normalize: log pasa a log10 y ln queda ln", normalize("log(x) + ln(x)"), "log10(x) + ln(x)");
check("normalize: aplicarla dos veces da lo mismo", ["log(4*x) = 3", "ln(x) = 1", "log_2(x)", "f(x) = x(x+1)", "2x = 3,5"].every((s) => normalize(normalize(s)) === normalize(s)), true);
check("normalize: f(x) sigue siendo función y x(x+1) es producto", normalize("f(x) = x(x+1)"), "f(x) = x*(x+1)");

const pesos: Item = { ...orig, text: "Ana compró 3 kilos de manzanas y pagó $ 150. ¿Cuánto cuesta el kilo? Resolvé {{m4}}." };
check("montos en pesos con $ no son matemática suelta", staticIssues(pesos, { ...good, text: "Ana compra 3 kilos de manzanas. Paga $150. Resolvé {{m4}}. ¿Cuánto cuesta un kilo?" }, "lectura_facil"), []);
check("LaTeX entre $ sigue siendo matemática suelta", staticIssues(pesos, { ...good, text: "Ana compra 3 kilos y paga $ 150. Resolvé {{m4}}: $3p = 150$." }, "lectura_facil").includes("Hay matemática escrita fuera de los marcadores"), true);

const ids = (...xs: string[]) => xs.map((id) => ({ id }));
check("ejercicios: los incisos no suman", mainExercises(ids("1", "2a", "2b", "2c", "3.a", "3.b", "4")), 4);
const quince = Array.from({ length: 15 }, (_, i) => ["a", "b", "c"].map((l) => `${i + 1}${l}`)).flat();
check(`ejercicios: 15 con 3 incisos cada uno entran (${quince.length} incisos)`, scopeIssue(ids(...quince)), null);
check("ejercicios: 16 no entran", scopeIssue(ids(...quince, "16")), `Este práctico tiene 16 ejercicios. Por ahora adaptamos hasta ${MAX_EXERCISES}.`);
check("ejercicios: tope de incisos", scopeIssue(ids(...Array.from({ length: MAX_ITEMS + 1 }, (_, i) => `${(i % 10) + 1}.${i}`))), `Este práctico tiene ${MAX_ITEMS + 1} partes contando los incisos. Por ahora adaptamos hasta ${MAX_ITEMS}.`);

// La lectura de speakMath no va como aria-label del MathML (tapa MathCAT): va en un botón de audio aparte.
const ARIA_SPEECH = /aria-label\s*=\s*\{?\s*(?:speakMath|spokenItem|formulaAudio)/;
// Todo el código de la app: el adaptador, las páginas y los componentes que lo van a mostrar.
const sources = ["lib/adapter", "app", "components"]
  .flatMap((dir) => fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).map((f) => path.join(dir, f)))
  .filter((f) => /\.tsx?$/.test(f));
check("accesibilidad: speakMath nunca como aria-label", sources.filter((f) => ARIA_SPEECH.test(fs.readFileSync(f, "utf8"))), []);
check("accesibilidad: botón de audio por fórmula", formulaAudio({ id: "m1", mathjs: "x^2 = 9", latex: "x^2 = 9", role: "equation" }, 1), {
  buttonLabel: "Escuchar la fórmula 1",
  text: "x al cuadrado igual a 9",
});

// Pistas: los mismos números, pero la tarea cambió
const edades: Item = {
  id: "5",
  kind: "problema",
  text: "Juan tiene 5 años más que Ana. Entre los dos suman 35 años. ¿Cuántos años tiene Ana?",
  math: [],
  figure: "",
  unsure: false,
};
const edadesBien: AdaptedItem = { id: "5", text: "Juan tiene 5 años más que Ana. Entre los dos suman 35 años. ¿Qué edad tiene Ana?", steps: [], glossary: [], figure: "" };
check("pistas: reformular sin cambiar relaciones pasa", staticIssues(edades, edadesBien, "lectura_facil"), []);
check("pistas: sinónimo de en total", hintIssues("Entre todos juntaron 35 pesos.", "En total juntaron 35 pesos."), []);
check("pistas: más que pasa a menos que", staticIssues(edades, { ...edadesBien, text: edadesBien.text.replace("más que", "menos que") }, "lectura_facil"), [
  "Agrega «menos que», que no está en el original: puede ser una pista o cambiar la relación",
  "Saca «más que», que está en el original",
]);
check("pistas: agrega el método con los mismos números", staticIssues(orig, { ...good, steps: ["Dividí 150 entre 3."] }, "lectura_facil"), [
  "Agrega «dividir», que no está en el original: puede ser una pista o cambiar la relación",
]);
check("pistas: borra una negación", hintIssues("¿Cuántos estudiantes no aprobaron?", "¿Cuántos estudiantes perdieron?"), ["Saca «negación», que está en el original"]);
check("pistas: borra un dato de relación", hintIssues("Compró como máximo 4 cajas.", "Compró 4 cajas."), ["Saca «como máximo», que está en el original"]);
check("pistas: la negrita de dislexia no molesta", hintIssues("Resolvé la ecuación {{m1}}.", "**Resolvé** la ecuación {{m1}}."), []);

// Demo con Ecuaciones racionales (2.°, ej. 2): glosario y pasos que solo definen términos no son pistas
const racional: Item = {
  id: "2a",
  kind: "ecuacion",
  text: "Resolvé en R la ecuación {{m1}}, indicando previamente las restricciones.",
  math: [{ id: "m1", mathjs: "3/(x-1) = 2/x", latex: "\\frac{3}{x-1} = \\frac{2}{x}", role: "equation" }],
  figure: "",
  unsure: false,
};
const racionalBien: AdaptedItem = {
  id: "2a",
  text: "Resolvé la ecuación {{m1}}.",
  steps: ["Escribí los valores de x que anulan un denominador.", "Pasá la ecuación a una sin fracciones.", "Fijate qué soluciones quedan."],
  glossary: [
    { term: "Restricción", meaning: "Un valor que x no puede tomar porque anula un denominador." },
    { term: "Ecuación racional", meaning: "Una ecuación con la incógnita en un denominador. Al resolverla queda una ecuación sin fracciones." },
    { term: "Mínimo común múltiplo", meaning: "El menor número que es múltiplo de todos los denominadores. Sirve para multiplicar y sacar las fracciones." },
  ],
  figure: "",
};
check("pistas: glosario y pasos de una ecuación racional pasan", staticIssues(racional, racionalBien, "lector_pantalla"), []);
check("pistas: el glosario no cuenta palabras del término", staticIssues(racional, { ...racionalBien, glossary: [{ term: "Producto cruzado", meaning: "Una forma de pasar a una ecuación sin fracciones." }] }, "lector_pantalla"), []);
check("pistas: un paso con la orden del método sigue marcado", staticIssues(racional, { ...racionalBien, steps: [...racionalBien.steps, "Multiplicá ambos lados por el denominador común."] }, "lector_pantalla"), [
  "Agrega «multiplicar», que no está en el original: puede ser una pista o cambiar la relación",
]);
check("pistas: un paso en infinitivo con el método sigue marcado", hintIssues("Resolver {{m1}}.", "Resolver {{m1}}.\nMultiplicar ambos miembros por x.", false), [
  "Agrega «multiplicar», que no está en el original: puede ser una pista o cambiar la relación",
]);
check("pistas: el glosario con una orden de método sigue marcado", staticIssues(racional, { ...racionalBien, glossary: [{ term: "Restricción", meaning: "Multiplicá todo por los denominadores y fijate cuáles se anulan." }] }, "lector_pantalla"), [
  "El glosario agrega «multiplicar», que no está en el original: puede ser una pista o cambiar la relación",
]);
check("pistas: en una ecuación, una comparación nueva sigue marcada", hintIssues("Resolvé {{m1}}.", "Resolvé {{m1}}. Escribí solo las soluciones mayores que cero.", false), [
  "Agrega «mayor», que no está en el original: puede ser una pista o cambiar la relación",
]);
check("pistas: en una ecuación, sacar una negación del original sigue marcado", hintIssues("Resolvé {{m1}} sin usar calculadora.", "Resolvé {{m1}} con calculadora.", false), ["Saca «negación», que está en el original"]);
check("pistas: el glosario de un problema invierte la relación", staticIssues(edades, { ...edadesBien, glossary: [{ term: "edad", meaning: "Los años de una persona. Ana tiene menos que Juan." }] }, "lectura_facil"), [
  "El glosario agrega «menos que», que no está en el original: puede ser una pista o cambiar la relación",
]);
check("pistas: el glosario de un problema con el método sigue marcado", staticIssues(orig, { ...good, glossary: [{ term: "precio", meaning: "Lo que cuesta un kilo. Se calcula dividiendo lo que pagó." }] }, "lectura_facil"), [
  "El glosario agrega «dividir», que no está en el original: puede ser una pista o cambiar la relación",
]);
check("pistas: el glosario de un problema puede usar palabras de contexto", staticIssues(edades, { ...edadesBien, glossary: [{ term: "edad", meaning: "Los años que tiene una persona, sin contar los meses." }] }, "lectura_facil"), []);
check("pistas: mínimo común múltiplo no es una cota", hintIssues("Resolvé {{m1}}.", "Buscá el mínimo común múltiplo de los denominadores. Resolvé {{m1}}.", false), []);
check("pistas: en un problema, quitar un dato de relación sigue marcado", staticIssues(edades, { ...edadesBien, text: "Juan y Ana tienen 5 y 35 años en total. ¿Qué edad tiene Ana?" }, "lectura_facil").includes("Saca «más que», que está en el original"), true);

// Glosario, título e indicaciones pasan por los controles de números, matemática suelta y pistas
check("glosario: una definición en palabras pasa", staticIssues(orig, { ...good, glossary: [{ term: "kilo", meaning: "unidad para pesar las frutas" }] }, "lectura_facil"), []);
check("glosario: agrega un número, matemática y una pista", staticIssues(orig, { ...good, glossary: [{ term: "kilo", meaning: "son 1000 gramos: dividí 150 / 3" }] }, "lectura_facil"), [
  "El glosario agrega el número 1000",
  "El glosario tiene matemática escrita fuera de los marcadores",
  "El glosario agrega «dividir», que no está en el original: puede ser una pista o cambiar la relación",
]);
check("glosario: no tapa un dato que la consigna perdió", staticIssues(orig, { ...good, text: good.text.replace(" Paga 150 pesos.", ""), glossary: [{ term: "precio", meaning: "los 150 pesos" }] }, "lectura_facil"), [
  "Falta el dato 150",
]);
const encabezado = { title: "Práctico 3: ecuaciones", general_instructions: "Resolvé sin calculadora." };
check("encabezado: reformular pasa", headerIssues(encabezado, { title: "Práctico 3. Ecuaciones", general_instructions: "Resolvé los ejercicios sin calculadora." }), []);
check("encabezado: cambia un número, saca la negación y trae matemática", headerIssues(encabezado, { title: "Práctico 4: ecuaciones", general_instructions: "Usá calculadora: x = 2." }), [
  "En el título o las indicaciones: Falta el dato 3",
  "En el título o las indicaciones: Aparece el número 2, que no está en el original",
  "En el título o las indicaciones: Aparece el número 4, que no está en el original",
  "En el título o las indicaciones: Hay matemática escrita fuera de los marcadores",
  "En el título o las indicaciones: Saca «negación», que está en el original",
]);

// Tope de archivos: 4 MB entre todos (Vercel corta en 4,5 MB)
const MB = 1024 * 1024;
check("archivos: 4 MB justos entran", uploadIssue([{ type: "application/pdf", size: 3 * MB }, { type: "image/png", size: MB }]), null);
check("archivos: un byte más no entra", uploadIssue([{ type: "application/pdf", size: 3 * MB }, { type: "image/png", size: MB + 1 }]), "Los archivos pesan más de 4 MB entre todos. Probá con menos páginas o con fotos más livianas.");
check("archivos: el tope es 4 MB", MAX_BYTES, 4 * MB);

console.log(failed === 0 ? "\nTodo pasa." : `\n${failed} pruebas fallan.`);
process.exit(failed === 0 ? 0 : 1);
