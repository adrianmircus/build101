// Pruebas sin IA de las caras por ejercicio que ve el estudiante: dos estados, nunca «Mal» ni solo color.
// Correr con: npx tsx scripts/tests/test-caras.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExerciseFeedback } from "../../components/student/ExerciseFeedback";
import { OUTCOMES, outcomeOf } from "../../lib/rewards/exerciseFeedback";
import type { ExerciseStatus } from "../../lib/groups/types";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${name}${pass ? "" : `\n      esperado ${JSON.stringify(want)}\n      obtenido ${JSON.stringify(got)}`}`);
}
const html = (props: Parameters<typeof ExerciseFeedback>[0]) => renderToStaticMarkup(createElement(ExerciseFeedback, props));

const statuses: ExerciseStatus[] = ["correct", "partial", "wrong", "blank"];
check("caras: cada estado de la corrección", statuses.map(outcomeOf), ["correct", "notYet", "notYet", "notYet"]);

const labels = Object.values(OUTCOMES).map((o) => o.label);
check(
  "caras: los textos no retan",
  labels.filter((l) => /\bmal\b|incorrect|error|equivoc/i.test(l)),
  [],
);
check("caras: cada estado con su forma", new Set(Object.values(OUTCOMES).map((o) => o.shape)).size, 2);
check(
  "caras: el error no es rojo",
  Object.values(OUTCOMES).filter((o) => /red|rose/.test(o.box + o.ink)).length,
  0,
);

const wrong = html({ status: "wrong", exerciseNumber: 2 });
check("render: muestra el texto", wrong.includes(OUTCOMES.notYet.label), true);
check("render: muestra el número", wrong.includes("Ejercicio 2"), true);
check("render: la cara es decorativa", wrong.includes('aria-hidden="true"'), true);
check("render: sin role status por defecto", wrong.includes('role="status"'), false);
check("render: con live se anuncia", html({ status: "correct", live: true }).includes('role="status"'), true);
check(
  "render: forma distinta según el resultado",
  [html({ status: "correct" }), wrong].map((h) => h.match(/data-shape="(\w+)"/)?.[1]),
  ["circle", "square"],
);
check(
  "render: la acción aparece",
  html({ status: "partial", action: createElement("button", { type: "button" }, "Ver pista") }).includes("Ver pista"),
  true,
);

console.log(failed === 0 ? "\nTodo pasa." : `\n${failed} pruebas fallan.`);
process.exit(failed === 0 ? 0 : 1);
