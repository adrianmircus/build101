// Verificación de que la adaptación no cambió la matemática. No importa el SDK:
// la parte estática corre también en el navegador (sirve para la demo de "sabotaje" en vivo).
import { checkSteps, compareSteps, fmt, stepSet, type MathStep, type Verdict } from "./equivalence";
import { readability } from "./readability";
import type { AdaptedItem, Adjustment, Extraction, Format, Item, MathModel, MathObject } from "./adapt-schemas";

export interface ItemCheck {
  id: string;
  ok: boolean;
  issues: string[];
  solution: Verdict | "no_aplica"; // solo para problemas con texto
  readability: { before: number; after: number };
}

const PLACEHOLDER = /\{\{(m\d+)\}\}/g;
// El signo $ solo cuenta si abre LaTeX ($x^2$, $\frac{1}{2}$): "$ 150" o "$1500" son montos en pesos.
const RAW_MATH = /\d\s*[+*/^=×÷]\s*[\d(]|[a-z]\s*\^\s*\d|\d\s*-\s*\d|\b[a-z]\s*=\s*-?\d|\\[a-z]+|\$[^$\n]*[\\^_{}=][^$\n]*\$/i;

// Alcance: hasta 15 ejercicios principales. Los incisos (2a, 2b, 2.c) cuentan dentro de su ejercicio;
// el tope de incisos es para que la adaptación de un formato entre en una sola respuesta del modelo.
export const MAX_EXERCISES = 15;
export const MAX_ITEMS = 60;

const UNITS: Record<string, number> = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const NUMBER_WORDS: Record<string, number> = {
  cero: 0, ...UNITS, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, "dieciséis": 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiuno: 21, "veintidós": 22, "veintitrés": 23, veinticuatro: 24, veinticinco: 25,
  "veintiséis": 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, ...TENS, cien: 100, mil: 1000,
  doble: 2, triple: 3, mitad: 0.5, tercio: 1 / 3,
};
const has = (o: Record<string, number>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// Número en cifras con signo pegado (-5), decimal con coma o punto, exponente (1e3) y fracción (1/2).
// El signo solo cuenta si no viene pegado a otra cifra: en "3-4" el 4 es positivo.
const NUMBER = /(?<![\w.,])(-?)(\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)(?:\/(\d+(?:[.,]\d+)?))?/g;

export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort();
}

function stripPlaceholders(text: string, replacement = " "): string {
  return text.replace(PLACEHOLDER, replacement);
}

// Números presentes en el texto (en cifras o en palabras), sin contar los marcadores.
export function numbersIn(text: string): number[] {
  const t = stripPlaceholders(text).toLowerCase().replace(/[−–]/g, "-");
  const out = new Set<number>();
  for (const m of t.matchAll(NUMBER)) {
    const num = Number(m[2].replace(",", "."));
    const den = m[3] ? Number(m[3].replace(",", ".")) : 1;
    const value = ((m[1] ? -1 : 1) * num) / den;
    if (Number.isFinite(value)) out.add(value);
  }
  const words = t.split(/[^a-záéíóúüñ]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (has(TENS, w) && words[i + 1] === "y" && has(UNITS, words[i + 2] ?? "")) {
      out.add(TENS[w] + UNITS[words[i + 2]]); // treinta y dos -> 32
      i += 2;
    } else if (has(NUMBER_WORDS, w)) {
      out.add(NUMBER_WORDS[w]);
    }
  }
  return [...out].sort((a, b) => a - b);
}

const fmtNum = (n: number) => String(+n.toFixed(4)).replace(".", ",");

export function fillMath(text: string, math: MathObject[]): string {
  return text.replace(PLACEHOLDER, (_, id: string) => {
    const m = math.find((x) => x.id === id);
    return m ? `[${m.mathjs}]` : "[?]";
  });
}

// Ejercicios principales: los ids que empiezan con el mismo número (2a, 2b, 2.c, 2) son un solo ejercicio.
export function mainExercises(items: { id: string }[]): number {
  return new Set(items.map((it) => it.id.match(/\d+/)?.[0] ?? it.id.trim().toLowerCase())).size;
}

// Menos ítems: quedan los que el profe eligió. "2" deja todo el ejercicio 2 (2a, 2b); "2b" deja solo ese inciso.
export function keepItems<T extends { id: string }>(items: T[], keep: string[]): T[] {
  const want = new Set(keep.map((k) => k.trim().toLowerCase()).filter(Boolean));
  return items.filter((it) => {
    const id = it.id.trim().toLowerCase();
    return want.has(id) || want.has(id.match(/\d+/)?.[0] ?? id);
  });
}

// null si el práctico entra en el alcance; si no, el mensaje para el profe.
export function scopeIssue(items: { id: string }[]): string | null {
  const n = mainExercises(items);
  if (n > MAX_EXERCISES) return `Este práctico tiene ${n} ejercicios. Por ahora adaptamos hasta ${MAX_EXERCISES}.`;
  if (items.length > MAX_ITEMS) return `Este práctico tiene ${items.length} partes contando los incisos. Por ahora adaptamos hasta ${MAX_ITEMS}.`;
  return null;
}

// Palabras que cambian la relación entre los datos o funcionan como pista del método. Si la adaptación agrega
// una que no estaba ("menos que" en lugar de "más que", "Sumá…") o saca una del original (una negación, "como máximo"),
// el ejercicio va a revisión: puede haber cambiado la tarea aunque los números sean los mismos.
const word = (src: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, "iu");
const RELATIONS: [string, RegExp][] = [
  ["más que", word("más\\s+(?:\\p{L}+\\s+)?que")],
  ["menos que", word("menos\\s+(?:\\p{L}+\\s+)?que")],
  ["más de", word("más\\s+de")],
  ["menos de", word("menos\\s+de")],
  ["mayor", word("mayor(?:es)?")],
  ["menor", word("menor(?:es)?")],
  ["como mínimo", word("al\\s+menos|por\\s+lo\\s+menos|como\\s+mínimo|mínimo")],
  ["como máximo", word("como\\s+máximo|a\\s+lo\\s+sumo|máximo")],
  ["doble", word("doble")],
  ["triple", word("triple")],
  ["mitad", word("mitad")],
  ["tercio", word("tercio|tercera\\s+parte")],
  ["veces", word("veces")],
  ["cada", word("cada")],
  ["en total", word("en\\s+total|total|junt[oa]s|entre\\s+tod[oa]s|entre\\s+(?:los|las)\\s+(?:dos|tres|cuatro)")],
  ["sumar", word("sum(?:a|á|ar|ando|an|as|ás|en|e|ad[oa]s?)")],
  ["restar", word("rest(?:a|á|ar|ando|an|as|ás|en|e)|diferencia")],
  ["multiplicar", word("multiplic\\p{L}*|producto")],
  ["dividir", word("divid\\p{L}*|división|cociente|repart\\p{L}*|partes\\s+iguales")],
  ["aumentar", word("aument\\p{L}*|increment\\p{L}*|recargo")],
  ["disminuir", word("disminu\\p{L}*|descuento|rebaja")],
  ["quedar o faltar", word("qued(?:a|an|ó|aron)|sobr(?:a|an|ó|aron)|falt(?:a|an|ó|aron)")],
  ["porcentaje", /%|(?<!\p{L})(?:por\s+ciento|porcentaje)(?!\p{L})/iu],
  ["aproximado", word("aproximad\\p{L}*|redonde\\p{L}*|alrededor\\s+de|cerca\\s+de|casi")],
  ["negación", word("no|nunca|ningún|ningun[oa]|nadie|tampoco|sin")],
  ["todos", word("(?<!entre\\s+)tod[oa]s")],
  ["exactamente", word("exactamente")],
];

function relationsIn(text: string): Set<string> {
  const t = stripPlaceholders(text).replace(/\*\*/g, "");
  return new Set(RELATIONS.filter(([, re]) => re.test(t)).map(([label]) => label));
}

export function hintIssues(origText: string, adaptedText: string): string[] {
  const before = relationsIn(origText);
  const after = relationsIn(adaptedText);
  const issues: string[] = [];
  for (const r of after) if (!before.has(r)) issues.push(`Agrega «${r}», que no está en el original: puede ser una pista o cambiar la relación`);
  for (const r of before) if (!after.has(r)) issues.push(`Saca «${r}», que está en el original`);
  return issues;
}

// answer: la respuesta del ejercicio original, si se conoce (sirve para que los apoyos no la regalen).
export function staticIssues(
  orig: Item,
  adapted: AdaptedItem | undefined,
  format: Format,
  ajustes: Adjustment[] = [],
  answer: number[] | null = null,
): string[] {
  if (!adapted) return ["Falta el ejercicio en la versión adaptada"];
  const body = [adapted.text, ...adapted.steps].join("\n");
  return [
    ...mathIssues(orig, adapted, body, format, ajustes),
    ...hintIssues(orig.text, body),
    ...glossaryIssues(orig, adapted, body, ajustes),
    ...supportIssues(orig, adapted, ajustes, answer),
  ];
}

// El glosario va aparte de la consigna: no puede traer números, matemática suelta ni relaciones que no estén en
// el original. Se controla solo (sin sumarlo a la consigna) para que no tape un dato o una relación que la consigna perdió.
export function glossaryIssues(orig: Item, adapted: AdaptedItem, body: string, ajustes: Adjustment[] = []): string[] {
  const glossary = adapted.glossary.map((g) => `${g.term}: ${g.meaning}`).join("\n");
  if (!glossary.trim()) return [];
  const issues: string[] = [];
  const allowed = numbersIn(simplerNumbers(orig, ajustes) ? body : orig.text);
  const own = placeholders(orig.text);
  const before = relationsIn(orig.text);
  for (const p of placeholders(glossary)) if (!own.includes(p)) issues.push(`El glosario usa {{${p}}}, que no es de este ejercicio`);
  for (const n of numbersIn(glossary)) if (!allowed.some((d) => near(d, n))) issues.push(`El glosario agrega el número ${fmtNum(n)}`);
  if (RAW_MATH.test(stripPlaceholders(glossary))) issues.push("El glosario tiene matemática escrita fuera de los marcadores");
  for (const r of relationsIn(glossary)) if (!before.has(r)) issues.push(`El glosario agrega «${r}», que no está en el original: puede ser una pista o cambiar la relación`);
  return issues;
}

// Título e indicaciones generales del práctico: pasan por los mismos controles que una consigna
// (marcadores, números, matemática suelta y pistas). Se comparan juntos porque la adaptación puede mover texto de uno al otro.
export const HEADER_ID = "encabezado";
type Header = Pick<Extraction, "title" | "general_instructions">;

export function headerIssues(orig: Header, adapted: Header): string[] {
  const text = (h: Header) => [h.title, h.general_instructions].join("\n");
  const item: Item = { id: HEADER_ID, kind: "otro", text: text(orig), math: [], figure: "", unsure: false };
  return staticIssues(item, { id: HEADER_ID, text: text(adapted), steps: [], glossary: [], figure: "" }, "lectura_facil").map(
    (issue) => `En el título o las indicaciones: ${issue}`,
  );
}

// Con "números más simples", los datos de un problema con texto pueden cambiar: ahí no se controlan los números.
const simplerNumbers = (orig: Item, ajustes: Adjustment[]) => ajustes.includes("numeros_simples") && orig.kind === "problema";

// Marcadores, datos numéricos, matemática suelta y figura: si algo de esto falla, la matemática ya no es la misma.
function mathIssues(orig: Item, adapted: AdaptedItem, body: string, format: Format, ajustes: Adjustment[] = []): string[] {
  const issues: string[] = [];

  const want = placeholders(orig.text);
  const got = placeholders(body);
  for (const p of want) if (!got.includes(p)) issues.push(`Falta la expresión {{${p}}}`);
  for (const p of got) if (!want.includes(p)) issues.push(`Usa {{${p}}}, que no es de este ejercicio`);

  if (!simplerNumbers(orig, ajustes)) {
    const before = numbersIn(orig.text);
    const after = numbersIn(body);
    for (const n of before) if (!after.includes(n)) issues.push(`Falta el dato ${fmtNum(n)}`);
    for (const n of after) if (!before.includes(n)) issues.push(`Aparece el número ${fmtNum(n)}, que no está en el original`);
  }

  if (RAW_MATH.test(stripPlaceholders(body))) issues.push("Hay matemática escrita fuera de los marcadores");

  if (orig.figure && format === "lector_pantalla") {
    if (!adapted.figure.trim()) issues.push("Falta la descripción de la figura");
    else {
      const fig = numbersIn(adapted.figure);
      for (const n of numbersIn(orig.figure)) if (!fig.includes(n)) issues.push(`A la descripción de la figura le falta el dato ${fmtNum(n)}`);
    }
  }
  return issues;
}

const eqStep = (math: string, n = 1): MathStep => ({ n, kind: "equation", math, set_type: "not_a_set", values: [] });
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));

// Apoyos de los ajustes de dificultad (preguntas guía, recordatorio, ejemplo resuelto). Pueden bajar la dificultad,
// pero no pueden regalar la respuesta, traer matemática suelta ni aparecer si el profe no los habilitó.
export function supportIssues(orig: Item, adapted: AdaptedItem, ajustes: Adjustment[], answer: number[] | null): string[] {
  const s = adapted.support;
  if (!s) return [];
  const issues: string[] = [];
  const on = (a: Adjustment) => ajustes.includes(a);
  const guide = s.guide.map((g) => g.trim()).filter(Boolean).join("\n");
  const reminder = s.reminder.trim();
  const ex = s.example;
  const hasExample = ex.statement.trim() !== "" || ex.steps.length > 0;

  if (guide && !on("preguntas_guia")) issues.push("Tiene preguntas guía, pero el profe no habilitó ese ajuste");
  if (reminder && !on("recordatorio")) issues.push("Tiene un recordatorio, pero el profe no habilitó ese ajuste");
  if (hasExample && !on("ejemplo_resuelto")) issues.push("Tiene un ejemplo resuelto, pero el profe no habilitó ese ajuste");

  const data = numbersIn(orig.text);
  // La respuesta solo delata si no es también un dato del enunciado.
  const secret = (answer ?? []).filter((a) => !data.some((d) => near(d, a)));
  const own = placeholders(orig.text);

  if (guide && on("preguntas_guia")) {
    // Las preguntas pueden nombrar los datos (los del original, o los nuevos si se simplificaron los números).
    const allowed = simplerNumbers(orig, ajustes) ? numbersIn([adapted.text, ...adapted.steps].join("\n")) : data;
    if (RAW_MATH.test(stripPlaceholders(guide))) issues.push("Las preguntas guía tienen matemática escrita fuera de los marcadores");
    for (const p of placeholders(guide)) if (!own.includes(p)) issues.push(`Las preguntas guía usan {{${p}}}, que no es de este ejercicio`);
    const nums = numbersIn(guide);
    for (const n of nums) if (!allowed.some((d) => near(d, n))) issues.push(`Las preguntas guía agregan el número ${fmtNum(n)}`);
    for (const a of secret) if (nums.some((n) => near(n, a))) issues.push(`Las preguntas guía dan la respuesta del ejercicio (${fmtNum(a)})`);
  }

  if (reminder && on("recordatorio")) {
    if (RAW_MATH.test(stripPlaceholders(reminder)) || placeholders(reminder).length > 0) issues.push("El recordatorio tiene matemática: tiene que ser el procedimiento general, en palabras");
    const nums = numbersIn(reminder);
    for (const n of nums) if (Math.abs(n) > 1 && data.some((d) => near(d, n))) issues.push(`El recordatorio usa el dato ${fmtNum(n)} del ejercicio`);
    for (const a of secret) if (nums.some((n) => near(n, a))) issues.push(`El recordatorio da la respuesta del ejercicio (${fmtNum(a)})`);
  }

  if (hasExample && on("ejemplo_resuelto")) {
    if (!ex.statement.trim() || ex.steps.length < 2) {
      issues.push("El ejemplo resuelto está incompleto: necesita la consigna y al menos dos pasos");
    } else {
      for (const n of numbersIn(ex.statement)) {
        if (Math.abs(n) > 1 && data.some((d) => near(d, n))) issues.push(`El ejemplo usa el dato ${fmtNum(n)} del ejercicio: tiene que tener otros números`);
      }
      const steps = ex.steps.map((m, i) => eqStep(m, i + 1));
      const chain = checkSteps(steps);
      if (chain.firstError !== null) issues.push(`En el ejemplo resuelto, el paso ${chain.firstError} no sale del anterior`);
      else if (!chain.allVerified) issues.push("No se pudo verificar la resolución del ejemplo: tiene que ser una ecuación de una incógnita por paso");
      const last = stepSet(steps[steps.length - 1]);
      if (answer && last && last !== "all" && last.some((v) => answer.some((a) => near(a, v)))) issues.push("El ejemplo da la misma respuesta que el ejercicio");
    }
  }
  return issues;
}

// Respuesta del ejercicio original, cuando se puede calcular sin IA (ecuaciones) o con el planteo independiente (problemas).
async function originalAnswer(orig: Item, originalModel: Promise<MathModel> | undefined): Promise<number[] | null> {
  let equation: string | null = null;
  if (orig.kind === "ecuacion") equation = orig.math.find((m) => m.role === "equation")?.mathjs ?? null;
  if (orig.kind === "problema" && originalModel) {
    const m = await originalModel.catch(() => null);
    if (m?.solvable) equation = m.equation;
  }
  const set = equation ? stepSet(eqStep(equation)) : null;
  return set && set !== "all" && set.length > 0 ? set : null;
}

export async function checkItem(
  orig: Item,
  adapted: AdaptedItem | undefined,
  format: Format,
  originalModel: Promise<MathModel> | undefined,
  model: (text: string) => Promise<MathModel>,
  ajustes: Adjustment[] = [],
): Promise<ItemCheck> {
  const usesSupport = adapted?.support !== undefined;
  const answer = usesSupport ? await originalAnswer(orig, originalModel) : null;
  const issues = staticIssues(orig, adapted, format, ajustes, answer);
  const before = readability(stripPlaceholders(orig.text, "x"));
  const after = adapted ? readability(stripPlaceholders([adapted.text, ...adapted.steps].join(". "), "x")) : before;
  const simpler = simplerNumbers(orig, ajustes);

  // Problemas con texto: un planteo independiente del original y otro de la versión adaptada tienen que dar la misma solución.
  // Corre aunque haya pistas marcadas (un "más que" que pasó a "menos que" suele cambiar la respuesta), pero no si ya falta matemática.
  // Con números más simples la respuesta cambia a propósito: se controla que siga habiendo una respuesta única y entera.
  let solution: Verdict | "no_aplica" = "no_aplica";
  const mathIntact = adapted !== undefined && mathIssues(orig, adapted, [adapted.text, ...adapted.steps].join("\n"), format, ajustes).length === 0;
  if (orig.kind === "problema" && adapted && originalModel && mathIntact) {
    const adaptedText = fillMath([adapted.text, ...adapted.steps].join("\n"), orig.math);
    if (simpler) {
      const b = await model(adaptedText).catch(() => null);
      const set = b?.solvable ? stepSet(eqStep(b.equation)) : null;
      if (set === null) solution = "unchecked";
      else if (set === "all" || set.length !== 1) {
        solution = "error";
        issues.push("Con los números nuevos el problema no tiene una respuesta única");
      } else if (!set.every((v) => near(v, Math.round(v)))) {
        solution = "error";
        issues.push(`Con los números nuevos la respuesta no es entera (${fmt(set)})`);
      } else solution = "ok";
    } else {
      const [a, b] = await Promise.all([originalModel, model(adaptedText).catch(() => null)]);
      solution = a.solvable && b?.solvable ? compareSteps(eqStep(a.equation), eqStep(b.equation)).verdict : "unchecked";
      if (solution === "error") issues.push("La respuesta del problema cambió con la adaptación");
    }
  }

  // El ejemplo resuelto: su primer paso tiene que ser el planteo de su propia consigna.
  const ex = adapted?.support?.example;
  if (ajustes.includes("ejemplo_resuelto") && ex && ex.statement.trim() && ex.steps.length > 0) {
    const m = await model(ex.statement).catch(() => null);
    if (m?.solvable && compareSteps(eqStep(m.equation), eqStep(ex.steps[0])).verdict === "error") {
      issues.push("El planteo del ejemplo resuelto no coincide con su consigna");
    }
  }

  // Un problema sin verificar no queda como correcto: se reintenta y, si sigue igual, va a revisión.
  if (solution === "unchecked") issues.push(UNCHECKED_ISSUE);
  // Si la lectura del original no fue segura, el profe tiene que mirar el ejercicio aunque la adaptación pase todo.
  if (orig.unsure) issues.push(UNSURE_ISSUE);
  return { id: orig.id, ok: issues.length === 0, issues, solution, readability: { before, after } };
}

export const UNCHECKED_ISSUE = "No se pudo comprobar que la respuesta del problema siga siendo la misma";
export const UNSURE_ISSUE = "No estamos seguros de haber leído bien este ejercicio en el original: revisalo";

// Volver a adaptar no arregla una lectura dudosa del original: esos ejercicios van directo a revisión.
export function retryIssues(check: ItemCheck): string[] {
  return check.issues.filter((issue) => issue !== UNSURE_ISSUE);
}
