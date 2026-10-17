// Pruebas sin IA de los sistemas de ecuaciones lineales: clave de soluciones, pasos, ejemplos resueltos y planteos
// con dos incógnitas. Los sistemas son los del práctico de 1.º de bachillerato (soluciones de la página 3 del PDF).
// Correr con: npx tsx scripts/adapter/test-sistemas.ts
import { checkSteps, compareSystems, fmtSystem, isSystem, solvedForm, solveSystem, type MathStep } from "../../lib/adapter/equivalence";
import { speakMath } from "../../lib/adapter/speech";
import { answerKey, checkItem, compareModels, hintIssues, itemEquation, numbersIn, supportIssues } from "../../lib/adapter/verify";
import { splitEven } from "../../lib/adapter/batches";
import type { AdaptedItem, Item, MathModel, Support } from "../../lib/adapter/adapt-schemas";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${name}${pass ? "" : `\n      esperado ${JSON.stringify(want)}\n      obtenido ${JSON.stringify(got)}`}`);
}
const solve = (src: string) => {
  const s = solveSystem(src);
  return s ? fmtSystem(s) : null;
};
const steps = (...ms: string[]): MathStep[] => ms.map((math, i) => ({ n: i + 1, kind: "equation", math, set_type: "not_a_set", values: [] }));

// Resolución: los sistemas del ejercicio 1, 2 y 5 del práctico
check("1.i", solve("y = 2*x + 5; y = -x + 2"), "x = -1; y = 3");
check("1.ii (la página 3 del PDF dice {2, 5}: es una errata)", solve("2*x - 2*y = -10; 6*x + 3*y = -3"), "x = -2; y = 3");
check("1.iii, con producto implícito", solve("2x - 1 = y; 3x - y = 3"), "x = 2; y = 3");
check("1.iv", solve("3x + 5y = 5; -2x + 2y = -14"), "x = 5; y = -2");
check("2.a: compatible indeterminado", solve("y - 3x = 4; 6x - 2y = -8"), "infinitas soluciones (sistema compatible indeterminado)");
check("2.b: incompatible", solve("y + 2x = 3; -2x + 1 = y"), "ninguna solución (sistema incompatible)");
check("5.a: 3x3", solve("x - 2y + 2z = 6; 2x + 3y - z = 4; 3x + y - 2z = 1"), "x = 2; y = 1; z = 3");
check("4.c: con fracciones", solve("(3x - 5)/2 = y; (-7x + 2)/5 = y"), "x = 1; y = -1");
check("4.d: no lineal, queda sin clave", solve("x/(y + 3) = -2; (x - 9)/y = 1"), null);
check("una ecuación de dos incógnitas es un sistema", isSystem("y = 2*x + 5"), true);
check("una ecuación de una incógnita no es un sistema", isSystem("2*(x + 3) = 10"), false);

// Pasos: cada paso es el sistema completo
check("sustitución: sistemas equivalentes", compareSystems("y = x + 1; y = -x + 9", "y = x + 1; x + 1 = -x + 9").verdict, "ok");
check("reducción: combinar ecuaciones", compareSystems("2*x - 2*y = -10; 6*x + 3*y = -3", "6*x - 6*y = -30; 9*y = 27").verdict, "ok");
check("un paso mal hecho se marca", compareSystems("x = 4; y = 5", "x = 4; y = 6").verdict, "error");
check("perder una ecuación no es equivalente", compareSystems("y = x + 1; y = -x + 9", "x = 4").verdict, "error");
check("dos sistemas sin solución son equivalentes", compareSystems("x + y = 1; x + y = 2", "2*x + 2*y = 2; x + y = 3").verdict, "ok");
check(
  "cadena completa de sustitución",
  checkSteps(steps("y = x + 1; y = -x + 9", "y = x + 1; x + 1 = -x + 9", "y = x + 1; 2*x = 8", "y = x + 1; x = 4", "x = 4; y = 5")).allVerified,
  true,
);
check("forma resuelta: cada incógnita con su valor", solvedForm("x = 4; y = 5", ["x", "y"]), true);
check("forma resuelta: también al revés (5 = y)", solvedForm("x = 4; 5 = y", ["x", "y"]), true);
check("forma resuelta: falta y", solvedForm("y = x + 1; x = 4", ["x", "y"]), false);

// Clave de soluciones (pestaña Original)
const m = (id: string, mathjs: string) => ({ id, mathjs, latex: "", role: "equation" as const });
const item = (math: Item["math"], kind: Item["kind"] = "ecuacion"): Item => ({ id: "1", kind, text: "Resolvé {{m1}}", math, figure: "", unsure: false, block: "" });
check("sistema en un marcador", itemEquation(item([m("m1", "y = 2*x + 5; y = -x + 2")])), "y = 2*x + 5; y = -x + 2");
check("sistema en dos marcadores: se juntan", itemEquation(item([m("m1", "y = 2*x + 5"), m("m2", "y = -x + 2")])), "y = 2*x + 5; y = -x + 2");
check("dos ecuaciones de una incógnita no se juntan", itemEquation(item([m("m1", "2*x = 4"), m("m2", "3*x = 9")])), "2*x = 4");
check("clave de un sistema", answerKey("y = 2*x + 5; y = -x + 2"), "x = -1; y = 3");
check("clave de un sistema incompatible", answerKey("y + 2*x = 3; -2*x + 1 = y"), "ninguna solución (sistema incompatible)");
const goles: MathModel = { solvable: true, unknown: "x, y", equation: "x + y = 26; x - y = 4", asks_for: "goles de Suárez y de Cavani" };
check("clave de un problema con dos incógnitas", answerKey(goles.equation, goles), "x = 15; y = 11 (goles de Suárez y de Cavani)");
const estudiantes: MathModel = { solvable: true, unknown: "s", equation: "s + g = 418; 60*s + 105*g = 35880", asks_for: "estudiantes" };
check("clave: solo la incógnita que se pregunta", answerKey(estudiantes.equation, estudiantes), "s = 178 (estudiantes)");
const dias: MathModel = { solvable: true, unknown: "x", equation: "300*(10 - x) + 500*x = 3600", asks_for: "días superiores al promedio" };
check("clave de una incógnita con lo que representa", answerKey(dias.equation, dias), "{3} (días superiores al promedio)");

// Planteos de un mismo problema: el original y el de la adaptación
const cavani: MathModel = { solvable: true, unknown: "c", equation: "c + (c + 4) = 26", asks_for: "goles de Cavani" };
const golesCambiados: MathModel = { ...goles, equation: "x + y = 28; x - y = 4" };
check("sistema y ecuación de una incógnita para el mismo problema", compareModels(goles, cavani), "ok");
check("dos sistemas con otras letras", compareModels(goles, { ...goles, unknown: "s, c", equation: "s + c = 26; s = c + 4" }), "ok");
check("si la respuesta cambia, se marca", compareModels(goles, golesCambiados), "error");
check("si cambia y el otro es de una incógnita, también", compareModels(golesCambiados, cavani), "error");
check("un sistema sin solución única no se puede comparar", compareModels(goles, { ...goles, equation: "x + y = 26; 2*x + 2*y = 52" }), "unchecked");

// Ejemplo resuelto de un sistema
const sistema = item([m("m1", "y = 2*x + 5; y = -x + 2")]);
const conEjemplo = (exampleSteps: string[]): AdaptedItem => {
  const support: Support = { guide: [], reminder: "", example: { statement: "Resolvé el sistema con y igual a x más 1 e y igual a menos x más 9.", steps: exampleSteps } };
  return { id: "1", text: "Resolvé {{m1}}", steps: [], glossary: [], figure: "", support };
};
const respuesta = [-1, 3];
const ej = ["y = x + 1; y = -x + 9", "y = x + 1; x + 1 = -x + 9", "y = x + 1; x = 4"];
check("ejemplo que termina sin y", supportIssues(sistema, conEjemplo(ej), ["ejemplo_resuelto"], respuesta), [
  "El ejemplo resuelto tiene que terminar con el valor de cada incógnita (x = …; y = …)",
]);
check("ejemplo completo", supportIssues(sistema, conEjemplo([...ej, "x = 4; y = 5"]), ["ejemplo_resuelto"], respuesta), []);
check("ejemplo con un paso mal", supportIssues(sistema, conEjemplo([...ej, "x = 4; y = 6"]), ["ejemplo_resuelto"], respuesta), [
  "En el ejemplo resuelto, el paso 4 no sale del anterior",
]);
check(
  "ejemplo con la misma respuesta que el ejercicio",
  supportIssues(sistema, conEjemplo(["y = x + 4; y = -2*x + 1", "y = x + 4; x + 4 = -2*x + 1", "y = x + 4; x = -1", "x = -1; y = 3"]), ["ejemplo_resuelto"], respuesta),
  ["El ejemplo da la misma respuesta que el ejercicio"],
);

// Falsas alarmas que hacían reintentar (medidas con el práctico de sistemas)
check("2x2 es el tamaño del sistema, no un dato", numbersIn("Aplicación de sistemas de ecuaciones 2x2 en casos prácticos"), []);
check("las dos ecuaciones, los 2 métodos y cada uno no son datos", numbersIn("Resolvé por los 2 métodos. Mirá las dos ecuaciones. ¿Cuántos hizo cada uno?"), []);
check("dos peras sí es un dato", numbersIn("Juan tiene 2 manzanas y dos peras"), [2]);
check("solo cifras: sin números en palabras", numbersIn("¿Cuáles son los dos tipos de entrada? Son 418", false), [418]);
check("superiores al promedio y más que el promedio dicen lo mismo", hintIssues("sus ventas son superiores al promedio", "vende más que el promedio"), []);
check("más que pasa a menos que: se marca", hintIssues("vende más que el promedio", "vende menos que el promedio").length, 2);

// Lotes de ejercicios para adaptar en paralelo
check("10 ejercicios en lotes de hasta 4", splitEven([...Array(10).keys()]).map((b) => b.length), [4, 3, 3]);
check("3 ejercicios, un lote", splitEven([1, 2, 3]).map((b) => b.length), [3]);
check("ningún ejercicio, ningún lote", splitEven([]), []);
check("los lotes conservan el orden", splitEven([...Array(9).keys()]).flat(), [...Array(9).keys()]);

// Lectura en voz alta
check("un sistema se lee ecuación por ecuación", speakMath("y = 2*x + 5; y = -x + 2"), "Sistema de dos ecuaciones. Ecuación 1: y igual a 2 x más 5. Ecuación 2: y igual a menos x más 2");

// checkItem: problema que pregunta por los dos, con planteos simulados (sin IA)
const problema: Item = {
  id: "3a",
  kind: "problema",
  text: "Luis Suarez y Edinson Cavani compitieron a patearle penales a Muslera. En total le hicieron 26 goles. ¿Cuantos goles hizo cada uno si Suarez hizo 4 goles más que Cavani?",
  math: [],
  figure: "",
  unsure: false,
  block: "",
};
const enCocina: AdaptedItem = {
  id: "3a",
  text: "Luis y Edinson cocinaron empanadas. En total hicieron 26 empanadas. ¿Cuántas empanadas hizo cada uno si Luis hizo 4 empanadas más que Edinson?",
  steps: [],
  glossary: [],
  figure: "",
};
const run = async () => {
  const ok = await checkItem(problema, enCocina, "lectura_facil", Promise.resolve(goles), async () => ({ ...goles, unknown: "l, d", equation: "l + d = 26; l = d + 4" }));
  check("problema con dos incógnitas: la respuesta coincide", [ok.ok, ok.solution, ok.issues], [true, "ok", []]);
  const mal = await checkItem(problema, enCocina, "lectura_facil", Promise.resolve(goles), async () => golesCambiados);
  check("problema con dos incógnitas: la respuesta cambió", [mal.ok, mal.solution], [false, "error"]);

  console.log(failed === 0 ? "\nTodo pasa." : `\n${failed} pruebas fallan.`);
  process.exit(failed === 0 ? 0 : 1);
};
run();
