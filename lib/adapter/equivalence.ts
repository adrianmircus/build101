// Chequeo determinístico de equivalencia entre pasos consecutivos.
// No usa IA: evalúa numéricamente con mathjs y compara conjuntos solución.
import { isSymbolNode, parse } from "mathjs";

export type StepKind = "equation" | "expression" | "solution_set";
export type SetType = "finite" | "all" | "empty" | "not_a_set";

export interface MathStep {
  n: number;
  kind: StepKind;
  math: string; // sintaxis mathjs: 2*(x+3) = 10
  set_type: SetType; // solo importa si kind === "solution_set"
  values: string[]; // soluciones, p. ej. ["3", "-3"]
}

export type Verdict = "ok" | "error" | "unchecked";

export interface Transition {
  from: number;
  to: number;
  verdict: Verdict;
  detail: string;
}

export interface CheckResult {
  transitions: Transition[];
  firstError: number | null; // n del primer paso que no se deduce del anterior
  allVerified: boolean; // todas las transiciones dieron "ok"
}

type Fn = (x: number) => number;
export type SolutionSet = number[] | "all";

const CONSTANTS = new Set(["pi", "e"]);
// Rango donde se buscan raíces reales: malla fina en [-100, 100] y, afuera, una malla geométrica hasta ±1.000.000
// (paso relativo de 0,05 %: 0,2 cerca de 400). Alcance declarado: soluciones en [-1.000.000, 1.000.000].
const LO = -100;
const HI = 100;
export const MAX_ABS = 1e6;
const GRID = 20000;
const OUTER_RATIO = 1 + 5e-4;
const ROOT_TOL = 1e-6; // relativo al tamaño de los lados de la ecuación
const SAME_TOL = 1e-6;
const MAX_ROOTS = 12;
const MAX_TOUCH_CANDIDATES = 50;
const PROBES = [-41.3, -9.7, -3.3, -1.1, -0.4, 0.27, 0.9, 1.7, 2.9, 5.3, 11.1, 23.7];

const GRID_XS: number[] = (() => {
  const inner: number[] = [];
  for (let i = 0; i <= GRID; i++) inner.push(LO + ((HI - LO) * i) / GRID); // exacto en los enteros, incluidos los extremos y el 0
  const outer: number[] = [];
  for (let x = HI * OUTER_RATIO; x < MAX_ABS; x *= OUTER_RATIO) outer.push(x);
  outer.push(MAX_ABS);
  return [...outer.map((x) => -x).reverse(), ...inner, ...outer];
})();

// Funciones propias de mathjs que reciben más de un argumento: adentro, la coma separa argumentos (log(8, 2)).
// En las demás (f(1,5), log10(2,5), sqrt(0,25)) la coma es decimal.
const MULTI_ARG = new Set(["log", "nthRoot", "pow", "max", "min", "mod", "gcd", "lcm", "atan2", "round", "hypot"]);

export function normalize(src: string): string {
  const s = src
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/√/g, "sqrt")
    .trim();
  return decimalCommas(implicitProducts(logs(s)));
}

// Índice del paréntesis que cierra el que abre en open; -1 si no cierra.
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function topLevelComma(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

// En los prácticos uruguayos "log" es en base 10 y "ln" es el neperiano. mathjs usa log() para el neperiano, así que:
// log(x) -> log10(x); log(x, b) y log_b(x) -> logaritmo en base b; ln(x) queda ln(x) y se evalúa con Math.log.
// Es idempotente: aplicarla dos veces da lo mismo.
function logs(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const m = /^log(?:_\{?([\w.]+)\}?)?\(/.exec(s.slice(i));
    if (!m || /[\w.]/.test(s[i - 1] ?? "")) {
      out += s[i++];
      continue;
    }
    const open = i + m[0].length - 1;
    const end = closing(s, open);
    if (end < 0) {
      out += s.slice(i);
      break;
    }
    const inner = logs(s.slice(open + 1, end));
    if (m[1]) out += `log((${inner}), ${m[1]})`;
    else out += topLevelComma(inner) ? `log(${inner})` : `log10(${inner})`;
    i = end + 1;
  }
  return out;
}

// Una letra seguida de paréntesis es una función si es f, g, h o una mayúscula (f(x), P(x), A(r)), o si adentro hay
// una sola letra o un número (i(x), k(2)). Si no, es producto implícito: x(x+1) -> x*(x+1), que mathjs leería como función.
function implicitProducts(s: string): string {
  return s.replace(/(?<![A-Za-z_])([A-Za-z])\(/g, (match, name: string, offset: number) => {
    const end = closing(s, offset + 1);
    const inner = end < 0 ? "" : s.slice(offset + 2, end).trim();
    const isFunction = /[fghA-Z]/.test(name) || (/^(?:[a-z]|-?\d+(?:[.,]\d+)?)$/.test(inner) && inner !== name);
    return isFunction ? match : `${name}*(`;
  });
}

// Coma decimal uruguaya (3,5 -> 3.5), salvo dentro de una función de varios argumentos, donde los separa: log(8,2).
function decimalCommas(s: string): string {
  const inFunction: boolean[] = [];
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") inFunction.push(MULTI_ARG.has(/[A-Za-z]\w*$/.exec(s.slice(0, i))?.[0] ?? ""));
    else if (ch === ")") inFunction.pop();
    else if (ch === "," && !inFunction[inFunction.length - 1] && /\d/.test(s[i - 1] ?? "") && /\d/.test(s[i + 1] ?? "")) {
      out += ".";
      continue;
    }
    out += ch;
  }
  return out;
}

interface Compiled {
  fn: Fn;
  vars: string[];
}

function compile(src: string): Compiled {
  const node = parse(normalize(src));
  const vars = new Set<string>();
  node.traverse((n, path) => {
    if (isSymbolNode(n) && path !== "fn" && !CONSTANTS.has(n.name)) vars.add(n.name);
  });
  const code = node.compile();
  const [v] = [...vars];
  const fn: Fn = (x) => {
    try {
      const r = code.evaluate(v ? { ln: Math.log, [v]: x } : { ln: Math.log });
      return typeof r === "number" ? r : NaN; // complejos, booleanos, etc. -> fuera de dominio
    } catch {
      return NaN;
    }
  };
  return { fn, vars: [...vars] };
}

interface Equation {
  g: Fn; // lado izquierdo menos lado derecho
  lhs: Fn;
  rhs: Fn;
  vars: string[];
}

function equationFn(src: string): Equation | null {
  const parts = normalize(src).split("=");
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return null;
  const g = compile(`(${parts[0]}) - (${parts[1]})`);
  return { g: g.fn, lhs: compile(parts[0]).fn, rhs: compile(parts[1]).fn, vars: g.vars };
}

const IDENTITY_PROBES = [...PROBES, 0, 1, -1, 2, -2, 0.5, -0.5];

// true: los dos lados valen lo mismo en todos los puntos de prueba (tolerancia relativa, no absoluta).
// null: coinciden donde están definidos, pero algún punto cae fuera del dominio (x/x = 1, sqrt(x) = sqrt(x)),
// así que no se puede certificar "todos los reales".
function isIdentity(eq: Equation): boolean | null {
  let undefinedSomewhere = false;
  for (const x of IDENTITY_PROBES) {
    const a = eq.lhs(x);
    const b = eq.rhs(x);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      undefinedSomewhere = true;
      continue;
    }
    if (Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))) return false;
  }
  return undefinedSomewhere ? null : true;
}

function bisect(g: Fn, a: number, b: number): number {
  let fa = g(a);
  for (let k = 0; k < 80; k++) {
    const m = (a + b) / 2;
    const fm = g(m);
    if (fm === 0) return m;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = m;
      fa = fm;
    } else {
      b = m;
    }
  }
  return (a + b) / 2;
}

function minimizeAbs(g: Fn, a: number, b: number): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  for (let k = 0; k < 80; k++) {
    if (Math.abs(g(c)) < Math.abs(g(d))) b = d;
    else a = c;
    c = b - phi * (b - a);
    d = a + phi * (b - a);
  }
  return (a + b) / 2;
}

// Raíces reales de g en [-MAX_ABS, MAX_ABS]: cambios de signo (raíces simples) y mínimos de |g| que tocan 0 (raíces dobles).
// Las tolerancias son relativas al tamaño de los lados, para que una raíz en 418 valga igual que una en 4.
function solutionSet(eq: Equation): SolutionSet | null {
  const identity = isIdentity(eq);
  if (identity === null) return null;
  if (identity) return "all";
  const g = eq.g;
  const scale = (x: number) => Math.max(1, Math.abs(eq.lhs(x)), Math.abs(eq.rhs(x)));

  const xs = GRID_XS;
  const vs = xs.map(g);
  const last = xs.length - 1;

  const roots: number[] = [];
  // Ceros exactos de la malla, incluidos los extremos y los que están junto a puntos fuera del dominio (sqrt(x) = 0).
  for (let i = 0; i <= last; i++) if (vs[i] === 0) roots.push(xs[i]);
  for (let i = 1; i <= last; i++) {
    const a = vs[i - 1];
    const b = vs[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) {
      const r = bisect(g, xs[i - 1], xs[i]);
      // Descarta polos (1/x cambia de signo en 0): en una raíz, |g| queda muy por debajo del salto de la celda.
      if (Math.abs(g(r)) < Math.max(ROOT_TOL * scale(r), 1e-6 * Math.abs(b - a))) roots.push(r);
    }
  }
  let candidates = 0;
  for (let i = 1; i < last; i++) {
    const a = vs[i - 1];
    const m = vs[i];
    const b = vs[i + 1];
    if (![a, m, b].every(Number.isFinite)) continue;
    if (Math.sign(a) === 0 || Math.sign(a) !== Math.sign(b)) continue;
    // Mínimo local de |g| bien marcado: en una raíz doble, |g| en la malla cae al menos a la mitad.
    if (Math.abs(m) <= Math.abs(a) && Math.abs(m) <= Math.abs(b) && Math.abs(m) < 0.5 * Math.max(Math.abs(a), Math.abs(b))) {
      if (++candidates > MAX_TOUCH_CANDIDATES) return null; // oscila mucho: fuera de alcance
      const r = minimizeAbs(g, xs[i - 1], xs[i + 1]);
      if (Math.abs(g(r)) < 1e-9 * scale(r)) roots.push(r);
    }
  }

  roots.sort((p, q) => p - q);
  const unique = roots.filter((r, i) => i === 0 || Math.abs(r - roots[i - 1]) > Math.max(1e-5, 1e-8 * Math.abs(r)));
  return unique.length > MAX_ROOTS ? null : unique; // muchas raíces: probablemente periódica, fuera de alcance
}

function setFromValues(step: MathStep): SolutionSet | null {
  if (step.set_type === "all") return "all";
  if (step.set_type === "empty") return [];
  const nums: number[] = [];
  for (const v of step.values) {
    const c = compile(v);
    if (c.vars.length > 0) return null;
    const n = c.fn(0);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  nums.sort((a, b) => a - b);
  return nums.filter((r, i) => i === 0 || Math.abs(r - nums[i - 1]) > 1e-9);
}

export function stepSet(step: MathStep): SolutionSet | null {
  try {
    if (step.kind === "solution_set") return setFromValues(step);
    if (step.kind === "equation") {
      const eq = equationFn(step.math);
      if (!eq || eq.vars.length > 1) return null;
      return solutionSet(eq);
    }
  } catch {
    // no se pudo parsear: queda sin verificar
  }
  return null;
}

export function sameSet(a: SolutionSet, b: SolutionSet): boolean {
  if (a === "all" || b === "all") return a === b;
  if (a.length !== b.length) return false;
  return a.every((x, i) => Math.abs(x - b[i]) <= SAME_TOL * Math.max(1, Math.abs(x)));
}

// Para mostrar: coma decimal, como en los prácticos de Uruguay ({0,5; 3}).
export function fmt(s: SolutionSet): string {
  if (s === "all") return "todos los reales";
  if (s.length === 0) return "ninguna solución";
  return `{${s.map((x) => String(+x.toFixed(4)).replace(".", ",")).join("; ")}}`;
}

function sameExpression(f: Fn, g: Fn): Verdict {
  let compared = 0;
  for (const x of PROBES) {
    const a = f(x);
    const b = g(x);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    compared++;
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) return "error";
  }
  return compared >= 4 ? "ok" : "unchecked";
}

function compareExpressions(srcA: string, srcB: string, what = "Las expresiones"): { verdict: Verdict; detail: string } {
  try {
    const fa = compile(srcA);
    const fb = compile(srcB);
    if (fa.vars.length > 1 || fb.vars.length > 1) {
      return { verdict: "unchecked", detail: "Tiene más de una variable" };
    }
    const verdict = sameExpression(fa.fn, fb.fn);
    const detail =
      verdict === "ok"
        ? `${what} valen lo mismo`
        : verdict === "error"
          ? `${what} dan distinto para algún valor de la variable`
          : "No hay suficientes valores donde ambas estén definidas";
    return { verdict, detail };
  } catch {
    return { verdict: "unchecked", detail: "No se pudo leer la expresión" };
  }
}

// f(x) = 2*x + 3 define una función: no es una ecuación para resolver. Devuelve el nombre, la variable y la fórmula.
function definition(src: string): { name: string; v: string; rhs: string } | null {
  const parts = normalize(src).split("=");
  if (parts.length !== 2) return null;
  const m = /^\s*([A-Za-z])\(\s*([a-z])\s*\)\s*$/.exec(parts[0]);
  return m ? { name: m[1], v: m[2], rhs: parts[1] } : null;
}

const isEmpty = (s: SolutionSet) => s !== "all" && s.length === 0;
const outOfRange = (s: SolutionSet) => s !== "all" && s.some((x) => Math.abs(x) > MAX_ABS);

export function compareSteps(a: MathStep, b: MathStep): { verdict: Verdict; detail: string } {
  if (a.kind === "expression" && b.kind === "expression") return compareExpressions(a.math, b.math);
  if (a.kind === "expression" || b.kind === "expression") {
    return { verdict: "unchecked", detail: "Se pasa de una expresión a una ecuación" };
  }
  const da = a.kind === "equation" ? definition(a.math) : null;
  const db = b.kind === "equation" ? definition(b.math) : null;
  if (da || db) {
    if (da && db && da.name === db.name && da.v === db.v) return compareExpressions(da.rhs, db.rhs, `Las dos definiciones de ${da.name}(${da.v})`);
    return { verdict: "unchecked", detail: "Es la definición de una función, no una ecuación para resolver" };
  }
  const sa = stepSet(a);
  const sb = stepSet(b);
  if (sa === null || sb === null) {
    return { verdict: "unchecked", detail: "No se pudo calcular el conjunto solución" };
  }
  // Un conjunto vacío o fuera del rango nunca cuenta como coincidencia: "ninguna raíz entre -1.000.000 y 1.000.000"
  // en los dos lados puede ser dos soluciones distintas que quedaron afuera.
  if (outOfRange(sa) || outOfRange(sb)) {
    return { verdict: "unchecked", detail: "Hay una solución fuera del rango que se revisa (de -1.000.000 a 1.000.000)" };
  }
  if (isEmpty(sa) && isEmpty(sb)) {
    return { verdict: "unchecked", detail: "Ninguno de los dos tiene soluciones en el rango que se revisa: no se puede confirmar que coincidan" };
  }
  return sameSet(sa, sb)
    ? { verdict: "ok", detail: `Mismas soluciones: ${fmt(sa)}` }
    : { verdict: "error", detail: `Antes: ${fmt(sa)} · Después: ${fmt(sb)}` };
}

export function checkSteps(steps: MathStep[]): CheckResult {
  const transitions: Transition[] = [];
  for (let i = 1; i < steps.length; i++) {
    const r = compareSteps(steps[i - 1], steps[i]);
    transitions.push({ from: steps[i - 1].n, to: steps[i].n, ...r });
  }
  const firstErr = transitions.find((t) => t.verdict === "error");
  return {
    transitions,
    firstError: firstErr ? firstErr.to : null,
    allVerified: transitions.length > 0 && transitions.every((t) => t.verdict === "ok"),
  };
}
