// Casos de prueba del chequeo. Correr con: npx tsx scripts/test-equivalence.ts
import { checkSteps, type MathStep, type Verdict } from "../../lib/adapter/equivalence";

let n = 0;
const eq = (math: string): MathStep => ({ n: ++n, kind: "equation", math, set_type: "not_a_set", values: [] });
const ex = (math: string): MathStep => ({ n: ++n, kind: "expression", math, set_type: "not_a_set", values: [] });
const set = (...values: string[]): MathStep => ({ n: ++n, kind: "solution_set", math: values.join(" o "), set_type: "finite", values });
const none = (): MathStep => ({ n: ++n, kind: "solution_set", math: "sin solución", set_type: "empty", values: [] });

// firstError: primer paso con error esperado. verdicts: veredicto esperado de cada transición;
// si se omite, todas las anteriores al error tienen que dar "ok" (un "unchecked" no cuenta como correcto).
const cases: { name: string; steps: () => MathStep[]; firstError: number | null; verdicts?: Verdict[] }[] = [
  { name: "lineal correcta", steps: () => [eq("2*(x+3) = 10"), eq("2*x+6 = 10"), eq("2*x = 4"), eq("x = 2")], firstError: null },
  { name: "distributiva mal", steps: () => [eq("2*(x+3) = 10"), eq("2*x+3 = 10"), eq("2*x = 7"), eq("x = 7/2")], firstError: 2 },
  { name: "signo al trasponer", steps: () => [eq("3*x - 5 = 2*x + 1"), eq("3*x - 2*x = 1 - 5"), eq("x = -4")], firstError: 2 },
  { name: "raíz perdida", steps: () => [eq("x^2 = 9"), eq("x = 3")], firstError: 2 },
  { name: "dos raíces con conjunto", steps: () => [eq("x^2 = 9"), set("3", "-3")], firstError: null },
  { name: "fracción correcta", steps: () => [eq("(x+1)/2 = 3"), eq("x+1 = 6"), eq("x = 5")], firstError: null },
  { name: "factorización", steps: () => [eq("x^2 - 5*x + 6 = 0"), eq("(x-2)*(x-3) = 0"), set("2", "3")], firstError: null },
  { name: "raíz doble", steps: () => [eq("(x-2)^2 = 0"), eq("x = 2")], firstError: null },
  { name: "x en el denominador", steps: () => [eq("1/x = 2"), eq("1 = 2*x"), eq("x = 1/2")], firstError: null },
  { name: "coma decimal e implícita", steps: () => [eq("2x + 3 = 10"), eq("2x = 7"), eq("x = 3,5")], firstError: null },
  { name: "x(x+1) implícito", steps: () => [eq("x(x+1) = 0"), set("0", "-1")], firstError: null },
  { name: "cuadrado del binomio mal", steps: () => [ex("(x+2)^2"), ex("x^2 + 4")], firstError: 2 },
  { name: "cuadrado del binomio bien", steps: () => [ex("(x+2)^2"), ex("x^2 + 4*x + 4")], firstError: null },
  { name: "identidad", steps: () => [eq("2*(x+1) = 2*x + 2"), eq("0 = 0")], firstError: null },
  { name: "sin solución mal resuelta", steps: () => [eq("x + 1 = x + 2"), eq("x = 1")], firstError: 2 },

  // Hallazgos de la revisión de Codex
  { name: "coma como separador de argumentos", steps: () => [eq("x = log(8,2)"), set("3")], firstError: null },
  { name: "casi identidad no es identidad", steps: () => [eq("x + 1 = x + 1.0000000001"), none()], firstError: null, verdicts: ["unchecked"] },
  { name: "x/x = 1 no es todos los reales", steps: () => [eq("x/x = 1"), eq("0 = 0")], firstError: null, verdicts: ["unchecked"] },
  { name: "sqrt(x) = sqrt(x) no es todos los reales", steps: () => [eq("sqrt(x) = sqrt(x)"), eq("0 = 0")], firstError: null, verdicts: ["unchecked"] },
  { name: "raíz en el extremo izquierdo", steps: () => [eq("x + 100 = 0"), set("-100")], firstError: null },
  { name: "raíz junto a un punto fuera del dominio", steps: () => [eq("sqrt(x) = 0"), set("0")], firstError: null },

  // Piloto con prácticos de bachillerato: respuestas mayores a 100
  { name: "418 entradas contra 419", steps: () => [eq("x - 418 = 0"), eq("x - 419 = 0")], firstError: 2 },
  { name: "125 m contra 126 m", steps: () => [eq("3*x + 5 = 380"), eq("3*x + 5 = 383")], firstError: 2 },
  { name: "120 troncos bien", steps: () => [eq("x/4 = 30"), set("120")], firstError: null },
  { name: "raíz doble en 418", steps: () => [eq("(x - 418)^2 = 0"), set("418")], firstError: null },
  { name: "raíces de -5000 y 3000", steps: () => [eq("(x + 5000)*(x - 3000) = 0"), set("-5000", "3000")], firstError: null },
  { name: "cúbica con raíz en 100.000", steps: () => [eq("x^3 = 1e15"), set("100000")], firstError: null },
  { name: "polo grande no es raíz", steps: () => [eq("1/(x - 400) = 0"), none()], firstError: null, verdicts: ["unchecked"] },
  { name: "ninguna solución en los dos planteos no es coincidencia", steps: () => [eq("x + 1 = x + 2"), eq("x + 3 = x + 5")], firstError: null, verdicts: ["unchecked"] },
  { name: "vacío declarado contra ecuación sin raíces", steps: () => [eq("x^2 + 1 = 0"), none()], firstError: null, verdicts: ["unchecked"] },
  { name: "respuestas fuera del rango no coinciden", steps: () => [eq("x = 2000000"), eq("x = 3000000")], firstError: null, verdicts: ["unchecked"] },
  { name: "solución declarada fuera del rango", steps: () => [eq("x = 5000000"), set("5000000")], firstError: null, verdicts: ["unchecked"] },

  // Notación de funciones: f(x) no es f por x
  { name: "f(x) = 0 no es x = 0", steps: () => [eq("f(x) = 0"), eq("x = 0")], firstError: null, verdicts: ["unchecked"] },
  { name: "definición de f reescrita bien", steps: () => [eq("f(x) = 2*(x+3)"), eq("f(x) = 2*x + 6")], firstError: null },
  { name: "definición de f reescrita mal", steps: () => [eq("f(x) = 2*(x+3)"), eq("f(x) = 2*x + 3")], firstError: 2 },
  { name: "P(x) mayúscula", steps: () => [eq("P(x) = x^2 - 1"), eq("P(x) = (x-1)*(x+1)")], firstError: null },
  { name: "i(x) es una función, no el número imaginario", steps: () => [eq("i(x) = x + 1"), eq("i(x) = 1 + x")], firstError: null },
  { name: "definiciones de funciones distintas", steps: () => [eq("f(x) = x + 1"), eq("g(x) = x + 1")], firstError: null, verdicts: ["unchecked"] },

  // Logaritmos: log es en base 10, ln es el neperiano
  { name: "log(4x) = 3 da 250", steps: () => [eq("log(4*x) = 3"), set("250")], firstError: null },
  { name: "log(4x) = 3 no da 5,02 (neperiano)", steps: () => [eq("log(4*x) = 3"), set("5.0214")], firstError: 2 },
  { name: "ln(x) = 1 da e", steps: () => [eq("ln(x) = 1"), set("e")], firstError: null },
  { name: "log en base 2 con guion bajo", steps: () => [eq("log_2(x) = 3"), set("8")], firstError: null },
  { name: "log10 con coma decimal", steps: () => [eq("log10(x) = 0,5"), set("sqrt(10)")], firstError: null },
];

let failed = 0;
for (const c of cases) {
  n = 0;
  const r = checkSteps(c.steps());
  const got = r.transitions.map((t) => t.verdict);
  const verdictsOk = c.verdicts
    ? JSON.stringify(got) === JSON.stringify(c.verdicts)
    : r.transitions.filter((t) => c.firstError === null || t.to < c.firstError).every((t) => t.verdict === "ok");
  const pass = r.firstError === c.firstError && verdictsOk;
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${c.name}: esperado ${c.firstError}, obtenido ${r.firstError}`);
  if (!pass) for (const t of r.transitions) console.log(`      ${t.from}→${t.to} ${t.verdict}: ${t.detail}`);
}
console.log(failed === 0 ? `\nTodos los casos pasan (${cases.length}).` : `\n${failed} de ${cases.length} fallan.`);
process.exit(failed === 0 ? 0 : 1);
