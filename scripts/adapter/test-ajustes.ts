// Pruebas sin IA de los ajustes de dificultad. Correr con: npx tsx scripts/test-ajustes.ts
import { adaptSystem, needsSupport } from "../../lib/adapter/adapt-prompts";
import { checkItem, keepItems, retryIssues, staticIssues, supportIssues, UNCHECKED_ISSUE, UNSURE_ISSUE } from "../../lib/adapter/verify";
import type { AdaptedItem, Adjustment, Item, MathModel, Support } from "../../lib/adapter/adapt-schemas";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${name}${pass ? "" : `\n      esperado ${JSON.stringify(want)}\n      obtenido ${JSON.stringify(got)}`}`);
}

// Reglas del prompt
check("sin ajustes, la dificultad no cambia", adaptSystem("lectura_facil").includes("la misma dificultad"), true);
check("sin ajustes, no hay apoyos", adaptSystem("lectura_facil").includes("Ajustes habilitados"), false);
const conGuia = adaptSystem("lectura_facil", ["preguntas_guia"]);
check("con ajustes, la regla 4 los habilita", conGuia.includes("habilitó ajustes de dificultad") && !conGuia.includes("la misma dificultad"), true);
check("con ajustes, solo los habilitados", conGuia.includes("support.guide") && !conGuia.includes("support.example"), true);
check("menos ítems solo no pide apoyos al modelo", needsSupport(["menos_items"]), false);
check("números simples cambia la regla 3", adaptSystem("dislexia", ["numeros_simples"]).includes("te deja cambiarlos"), true);

// El problema de Suárez y Cavani (Sistemas, ej. 3a). Respuesta: 11.
const cavani: Item = {
  id: "3a",
  kind: "problema",
  text: "Luis Suarez y Edinson Cavani compitieron a patearle penales a Muslera. En total le hicieron 26 goles. ¿Cuantos goles hizo cada uno si Suarez hizo 4 goles más que Cavani?",
  math: [],
  figure: "",
  unsure: false,
};
const answer = [11];
const support: Support = {
  guide: ["¿Cuántos goles hicieron en total?", "¿Cuántos goles más que Cavani hizo Suarez?", "Si llamás x a los goles de Cavani, ¿cómo escribís los de Suarez?"],
  reminder: "Para despejar la incógnita, hacé la misma operación en los dos lados de la igualdad.",
  example: {
    statement: "Ana y Beto juntaron 10 figuritas. Ana tiene 2 más que Beto. ¿Cuántas tiene Beto?",
    steps: ["x + (x + 2) = 10", "2*x + 2 = 10", "2*x = 8", "x = 4"],
  },
};
const adapted: AdaptedItem = {
  id: "3a",
  text: "Luis Suarez y Edinson Cavani patearon penales a Muslera. En total hicieron 26 goles. Suarez hizo 4 goles más que Cavani. ¿Cuántos goles hizo cada uno?",
  steps: [],
  glossary: [],
  figure: "",
  support,
};
const todos: Adjustment[] = ["preguntas_guia", "recordatorio", "ejemplo_resuelto"];
const conApoyo = (s: Partial<Support>): AdaptedItem => ({ ...adapted, support: { ...support, ...s } });

check("apoyos correctos pasan", staticIssues(cavani, adapted, "lectura_facil", todos, answer), []);
check("apoyos sin ajuste habilitado", supportIssues(cavani, adapted, [], answer), [
  "Tiene preguntas guía, pero el profe no habilitó ese ajuste",
  "Tiene un recordatorio, pero el profe no habilitó ese ajuste",
  "Tiene un ejemplo resuelto, pero el profe no habilitó ese ajuste",
]);
check("la guía regala la respuesta", supportIssues(cavani, conApoyo({ guide: ["¿Cavani hizo 11 goles?"] }), todos, answer), [
  "Las preguntas guía agregan el número 11",
  "Las preguntas guía dan la respuesta del ejercicio (11)",
]);
check("la guía trae matemática suelta", supportIssues(cavani, conApoyo({ guide: ["Escribí x + 4 = 26 - x."] }), todos, answer).includes("Las preguntas guía tienen matemática escrita fuera de los marcadores"), true);
check("el recordatorio usa un dato", supportIssues(cavani, conApoyo({ reminder: "Restá 4 a los 26 goles." }), todos, answer), [
  "El recordatorio usa el dato 4 del ejercicio",
  "El recordatorio usa el dato 26 del ejercicio",
]);
check("el ejemplo copia los datos", supportIssues(cavani, conApoyo({ example: { ...support.example, statement: "Juntaron 26 figuritas. Ana tiene 2 más que Beto." } }), todos, answer), [
  "El ejemplo usa el dato 26 del ejercicio: tiene que tener otros números",
]);
check("el ejemplo tiene un paso mal", supportIssues(cavani, conApoyo({ example: { ...support.example, steps: ["x + (x + 2) = 10", "2*x + 2 = 10", "2*x = 9", "x = 4.5"] } }), todos, answer), [
  "En el ejemplo resuelto, el paso 3 no sale del anterior",
]);
check("el ejemplo da la misma respuesta", supportIssues(cavani, conApoyo({ example: { statement: "Juntaron 28 figuritas. Ana tiene 6 más que Beto.", steps: ["x + (x + 6) = 28", "2*x = 22", "x = 11"] } }), todos, answer), [
  "El ejemplo da la misma respuesta que el ejercicio",
]);
check("el ejemplo incompleto", supportIssues(cavani, conApoyo({ example: { statement: "Ana y Beto juntaron 10 figuritas.", steps: ["x = 4"] } }), todos, answer), [
  "El ejemplo resuelto está incompleto: necesita la consigna y al menos dos pasos",
]);

// Números más simples: los datos pueden cambiar solo en problemas con texto y solo con el ajuste.
const simple: AdaptedItem = { id: "3a", text: "Suarez y Cavani hicieron 10 goles en total. Suarez hizo 2 goles más que Cavani. ¿Cuántos goles hizo cada uno?", steps: [], glossary: [], figure: "" };
check("números nuevos sin el ajuste", staticIssues(cavani, simple, "lectura_facil").filter((i) => i.startsWith("Falta el dato") || i.startsWith("Aparece")).length > 0, true);
check("números nuevos con el ajuste", staticIssues(cavani, simple, "lectura_facil", ["numeros_simples"]), []);
check("con el ajuste, las relaciones se siguen controlando", staticIssues(cavani, { ...simple, text: simple.text.replace("más que", "menos que") }, "lectura_facil", ["numeros_simples"]).some((i) => i.includes("menos que")), true);

// Menos ítems
const ids = ["1", "2a", "2b", "3", "4"].map((id) => ({ id }));
check("menos ítems: el número deja todo el ejercicio", keepItems(ids, ["2", "4"]).map((i) => i.id), ["2a", "2b", "4"]);
check("menos ítems: un inciso solo", keepItems(ids, [" 2B "]).map((i) => i.id), ["2b"]);

// checkItem con un modelo de planteo simulado (sin IA)
const fake = (equation: string): ((t: string) => Promise<MathModel>) => async () => ({ solvable: true, unknown: "x", equation, asks_for: "" });
const original = Promise.resolve<MathModel>({ solvable: true, unknown: "x", equation: "x + (x + 4) = 26", asks_for: "goles de Cavani" });

const run = async () => {
  const ok = await checkItem(cavani, simple, "lectura_facil", original, fake("x + (x + 2) = 10"), ["numeros_simples"]);
  check("números simples: respuesta entera y única", [ok.ok, ok.solution], [true, "ok"]);
  const frac = await checkItem(cavani, { ...simple, text: simple.text.replace("10 goles", "9 goles") }, "lectura_facil", original, fake("x + (x + 2) = 9"), ["numeros_simples"]);
  check("números simples: respuesta no entera", frac.issues, ["Con los números nuevos la respuesta no es entera ({3.5})"]);
  // El modelo simulado plantea el ejercicio o el ejemplo según el texto que recibe.
  const route = (ejemplo: string) => async (t: string): Promise<MathModel> =>
    ({ solvable: true, unknown: "x", equation: t.startsWith("Ana y Beto") ? ejemplo : "x + (x + 4) = 26", asks_for: "" });
  const conApoyos = await checkItem(cavani, adapted, "lectura_facil", original, route("x + (x + 2) = 10"), todos);
  check("con apoyos: el planteo del original sigue igual", [conApoyos.ok, conApoyos.solution, conApoyos.issues], [true, "ok", []]);
  const malPlanteo = await checkItem(cavani, adapted, "lectura_facil", original, route("x + (x + 3) = 10"), todos);
  check("el planteo del ejemplo no coincide con su consigna", malPlanteo.issues, ["El planteo del ejemplo resuelto no coincide con su consigna"]);

  // Revisión: un problema sin verificar o una lectura dudosa del original nunca quedan como correctos.
  const sinApoyo: AdaptedItem = { ...adapted, support: undefined };
  const noPlanteable = Promise.resolve<MathModel>({ solvable: false, unknown: "", equation: "", asks_for: "" });
  const sinVerificar = await checkItem(cavani, sinApoyo, "lectura_facil", noPlanteable, fake("x + (x + 4) = 26"));
  check("revisión: un problema sin verificar no queda ok", [sinVerificar.ok, sinVerificar.solution, sinVerificar.issues], [false, "unchecked", [UNCHECKED_ISSUE]]);
  const dudoso = await checkItem({ ...cavani, unsure: true }, sinApoyo, "lectura_facil", original, fake("x + (x + 4) = 26"));
  check("revisión: una lectura dudosa va a revisión sin reintento", [dudoso.ok, dudoso.solution, dudoso.issues, retryIssues(dudoso)], [false, "ok", [UNSURE_ISSUE], []]);

  console.log(failed === 0 ? "\nTodo pasa." : `\n${failed} pruebas fallan.`);
  process.exit(failed === 0 ? 0 : 1);
};
run();
