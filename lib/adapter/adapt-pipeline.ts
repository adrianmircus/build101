// Pipeline: extraer (Claude) → adaptar los 3 formatos en paralelo (Claude) → verificar (código + planteo independiente)
// → reintentar una vez los ejercicios que fallan → marcar para revisión lo que siga fallando.
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getClient, MODEL } from "@/lib/agent/client";
import { isSystem, stepSet, type MathStep, type SolutionSet } from "./equivalence";
import { splitEven } from "./batches";
import { EXTRACT_SYSTEM, MODEL_SYSTEM, adaptSystem, needsSupport } from "./adapt-prompts";
import {
  AdaptationSchema,
  AdaptationWithSupportSchema,
  BASE_FORMATS,
  ExtractionSchema,
  isReasoning,
  MathModelSchema,
  NO_ADJUSTMENTS,
  type AdaptOptions,
  type Adaptation,
  type Adjustment,
  type Extraction,
  type Format,
  type MathModel,
} from "./adapt-schemas";
import {
  answerKey,
  applicableAdjustments,
  checkItem,
  fillMath,
  HEADER_ID,
  headerIssues,
  itemEquation,
  keepItems,
  retryIssues,
  scopeIssue,
  textReadability,
  withBlock,
  withBlockMath,
  blockInstruction,
  type ItemCheck,
  type NotApplied,
} from "./verify";

export type { NotApplied };

export class PipelineError extends Error {}

export type InputFile = {
  data: string; // base64
  mediaType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
};

export interface FormatResult {
  format: Format;
  adaptation: Adaptation;
  checks: ItemCheck[];
  header: { ok: boolean; issues: string[] }; // título e indicaciones generales; si no está ok, va a revisión
  retried: string[]; // ids que se regeneraron una vez
  ajustes: Adjustment[]; // los de esta versión: los de razonamiento disminuido van solo donde los pidió el profe
  dificultad_modificada: boolean; // la pantalla lo muestra en esta versión
  readability: { before: number | null; after: number | null }; // de toda la versión; null: no aplica
  ms: number;
}

export interface AdaptResult {
  extraction: Extraction; // con menos_items, solo los ejercicios que eligió el profe
  ajustes: Adjustment[]; // los que se aplicaron en alguna versión
  no_aplicados: NotApplied[]; // los que el profe pidió pero no cambian nada en este práctico
  dificultad_modificada: boolean; // alguna versión tiene la dificultad modificada (cada FormatResult dice cuál)
  intereses: string[]; // temas del estudiante con los que se reescribieron los problemas con texto
  razonamiento_en: Format[]; // versiones con los apoyos de razonamiento disminuido
  omitted: string[]; // ids que el profe sacó con menos_items
  answerKey: { id: string; solution: string; set: SolutionSet | null }[]; // calculada sin IA cuando se puede
  formats: FormatResult[];
  ms: { extract: number; total: number };
}

export type AdaptEvent =
  | { stage: "leyendo" }
  | { stage: "adaptando" | "verificando" | "reintentando"; format: Format }
  | { stage: "formato_listo"; result: FormatResult }
  | { stage: "fuera_de_alcance"; reason: string }
  | { stage: "listo"; result: AdaptResult }
  | { stage: "error"; message: string };

// Tokens de salida reservados a la vez, entre todas las adaptaciones del servidor. OpenRouter reserva saldo por cada
// llamada en vuelo según su max_tokens y corta con un 402 si la suma pasa el saldo: los lotes en paralelo de las 4
// versiones esperan su turno para no reservar más que antes de los lotes (4 llamadas de 16.000).
const MAX_RESERVED_TOKENS = 64000;
let reserved = 0;
const waiting: { tokens: number; start: () => void }[] = [];

function release(tokens: number) {
  reserved -= tokens;
  // En orden de llegada: el primero de la fila entra cuando hay lugar para él.
  while (waiting.length > 0 && reserved + waiting[0].tokens <= MAX_RESERVED_TOKENS) {
    const next = waiting.shift()!;
    reserved += next.tokens;
    next.start();
  }
}

async function limited<T>(tokens: number, call: () => Promise<T>): Promise<T> {
  if (waiting.length > 0 || reserved + tokens > MAX_RESERVED_TOKENS) {
    await new Promise<void>((start) => waiting.push({ tokens, start }));
  } else reserved += tokens;
  try {
    return await call();
  } finally {
    release(tokens);
  }
}

const NOT_SOLVABLE: MathModel = { solvable: false, unknown: "", equation: "", asks_for: "" };

export async function extract(files: InputFile[], text: string | null): Promise<Extraction> {
  const content: Anthropic.ContentBlockParam[] = files.map((f) =>
    f.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
      : { type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } },
  );
  if (text) content.push({ type: "text", text: `Práctico pegado como texto:\n\n${text}` });
  content.push({ type: "text", text: "Extraé el práctico." });

  const res = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: EXTRACT_SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ExtractionSchema) },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new PipelineError("No pudimos leer el práctico. Probá con otro archivo.");
  return res.parsed_output;
}

function practicoForPrompt(ex: Extraction): string {
  return JSON.stringify(
    {
      title: ex.title,
      general_instructions: ex.general_instructions,
      items: ex.items.map((it) => ({
        id: it.id,
        kind: it.kind,
        text: it.text,
        figure: it.figure,
        markers: it.math.map((m) => `{{${m.id}}} = ${m.latex}`), // contexto: no copiar
      })),
    },
    null,
    2,
  );
}

async function adaptCall(
  ex: Extraction,
  format: Format,
  ajustes: Adjustment[],
  intereses: string[],
  retry?: { previous: Adaptation; failures: { id: string; issues: string[] }[] },
): Promise<Adaptation> {
  let user = `Práctico:\n${practicoForPrompt(ex)}`;
  if (retry) {
    const list = retry.failures
      .map((f) => `- ${f.id === HEADER_ID ? "Título e indicaciones generales" : `Ejercicio ${f.id}`}: ${f.issues.join("; ")}`)
      .join("\n");
    user += `\n\nTu versión anterior de estos ejercicios:\n${JSON.stringify(retry.previous)}\n\nEl verificador encontró estos problemas. Corregilos y devolvé todos los ejercicios de este pedido:\n${list}`;
  }
  // Con ajustes de dificultad, cada ejercicio trae además sus apoyos (support).
  const schema = needsSupport(ajustes) ? AdaptationWithSupportSchema : AdaptationSchema;
  const res = await limited(8000, () => getClient().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: adaptSystem(format, ajustes, intereses),
    output_config: { effort: "medium", format: zodOutputFormat(schema) },
    messages: [{ role: "user", content: user }],
  }));
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new PipelineError("No pudimos adaptar el práctico. Probá de nuevo.");
  return res.parsed_output;
}

export async function modelProblem(text: string): Promise<MathModel> {
  const res = await limited(4000, () => getClient().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: MODEL_SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(MathModelSchema) },
    messages: [{ role: "user", content: text }],
  }));
  return res.parsed_output ?? NOT_SOLVABLE;
}

async function checkAll(
  ex: Extraction,
  adaptation: Adaptation,
  format: Format,
  originals: Map<string, Promise<MathModel>>,
  ajustes: Adjustment[],
) {
  return Promise.all(
    ex.items.map((it) =>
      checkItem(it, adaptation.items.find((a) => a.id === it.id), format, originals.get(it.id), modelProblem, ajustes),
    ),
  );
}

// Adapta los ejercicios dados en lotes en paralelo y junta las partes. El título y las indicaciones generales salen del
// primer lote; las notas para el profe, de todos. En un reintento, cada lote recibe solo sus ejercicios y sus fallas.
async function adaptBatched(
  ex: Extraction,
  items: Extraction["items"],
  format: Format,
  ajustes: Adjustment[],
  intereses: string[],
  retry?: { previous: Adaptation; failures: { id: string; issues: string[] }[] },
): Promise<Adaptation> {
  const groups = splitEven(items);
  const parts = await Promise.all(
    groups.map((group, i) => {
      const ids = new Set(group.map((it) => it.id));
      const own = retry && {
        previous: { ...retry.previous, items: retry.previous.items.filter((it) => ids.has(it.id)) },
        failures: retry.failures.filter((f) => ids.has(f.id) || (f.id === HEADER_ID && i === 0)),
      };
      return adaptCall({ ...ex, items: group }, format, ajustes, intereses, own);
    }),
  );
  return {
    title: parts[0].title,
    general_instructions: parts[0].general_instructions,
    items: parts.flatMap((part) => part.items),
    notes_for_teacher: parts
      .map((part) => part.notes_for_teacher.trim())
      .filter(Boolean)
      .join(" "),
  };
}

async function adaptFormat(
  ex: Extraction,
  format: Format,
  originals: Map<string, Promise<MathModel>>,
  onEvent: (e: AdaptEvent) => void,
  ajustes: Adjustment[],
  intereses: string[],
  readabilityBefore: ReturnType<typeof textReadability>,
): Promise<FormatResult> {
  const t0 = Date.now();
  onEvent({ stage: "adaptando", format });
  let adaptation = await adaptBatched(ex, ex.items, format, ajustes, intereses);

  onEvent({ stage: "verificando", format });
  let checks = await checkAll(ex, adaptation, format, originals, ajustes);
  let header = headerIssues(ex, adaptation);

  // Los ejercicios cuyo único problema es una lectura dudosa del original no se reintentan: van a revisión.
  const failures = checks.map((c) => ({ id: c.id, issues: retryIssues(c) })).filter((f) => f.issues.length > 0);
  const retried = failures.map((f) => f.id);
  if (failures.length > 0 || header.length > 0) {
    onEvent({ stage: "reintentando", format });
    const headerFailure = header.length > 0 ? [{ id: HEADER_ID, issues: header }] : [];
    // Solo se vuelven a generar los ejercicios que fallaron (y el primero, si lo que falló es el título).
    const redo = ex.items.filter((it) => retried.includes(it.id));
    const fixed = await adaptBatched(ex, redo.length > 0 ? redo : ex.items.slice(0, 1), format, ajustes, intereses, {
      previous: adaptation,
      failures: [...headerFailure, ...failures],
    });
    adaptation = {
      ...adaptation,
      ...(header.length > 0 ? { title: fixed.title, general_instructions: fixed.general_instructions } : {}),
      items: adaptation.items.map((it) => (retried.includes(it.id) ? (fixed.items.find((f) => f.id === it.id) ?? it) : it)),
    };
    checks = await checkAll(ex, adaptation, format, originals, ajustes);
    header = headerIssues(ex, adaptation);
  }

  const result: FormatResult = {
    format,
    adaptation,
    checks,
    header: { ok: header.length === 0, issues: header },
    retried,
    ajustes,
    dificultad_modificada: ajustes.length > 0,
    // Sobre el texto de toda la versión, no un promedio por ejercicio: un inciso de tres palabras no da un índice que sirva.
    readability: {
      before: readabilityBefore,
      after: textReadability(adaptation.items.flatMap((it) => [it.text, ...it.steps])),
    },
    ms: Date.now() - t0,
  };
  onEvent({ stage: "formato_listo", result });
  return result;
}

const eqStep = (math: string): MathStep => ({ n: 1, kind: "equation", math, set_type: "not_a_set", values: [] });

async function buildAnswerKey(ex: Extraction, originals: Map<string, Promise<MathModel>>) {
  return Promise.all(
    ex.items.map(async (it) => {
      let equation: string | null = null;
      let model: MathModel | undefined;
      if (it.kind === "ecuacion") equation = itemEquation(it);
      if (it.kind === "problema") {
        model = await originals.get(it.id);
        if (model?.solvable) equation = model.equation;
      }
      // Ecuaciones de una incógnita y sistemas lineales; lo demás queda en "—".
      const set = equation && !isSystem(equation) ? stepSet(eqStep(equation)) : null;
      return { id: it.id, solution: answerKey(equation, model), set: set && (set === "all" || set.length > 0) ? set : null };
    }),
  );
}

export async function adaptPractico(
  files: InputFile[],
  text: string | null,
  onEvent: (e: AdaptEvent) => void,
  options: AdaptOptions = NO_ADJUSTMENTS,
): Promise<AdaptResult | null> {
  const t0 = Date.now();
  onEvent({ stage: "leyendo" });
  const extracted = await extract(files, text);
  const extractMs = Date.now() - t0;
  const { ajustes } = options;

  // Menos ítems: el profe elige qué ejercicios quedan. Se filtra antes del tope de alcance,
  // así un práctico largo entra si el profe deja solo una parte.
  const all = withBlockMath(extracted.items);
  const kept = ajustes.includes("menos_items") ? keepItems(all, options.keep_items) : all;
  const omitted = all.filter((it) => !kept.includes(it)).map((it) => it.id);
  if (all.length > 0 && kept.length === 0) {
    onEvent({ stage: "fuera_de_alcance", reason: "Ninguno de los ejercicios elegidos está en el práctico. Revisá la numeración." });
    return null;
  }
  const ex: Extraction = { ...extracted, items: kept };
  if (!ex.legible || !ex.in_scope || ex.items.length === 0) {
    onEvent({ stage: "fuera_de_alcance", reason: ex.reason || "No encontramos ejercicios para adaptar." });
    return null;
  }
  // El tope de ejercicios lo cuenta el código, no el modelo: los incisos (2a, 2b) no suman ejercicios.
  const tooLong = scopeIssue(ex.items);
  if (tooLong) {
    onEvent({ stage: "fuera_de_alcance", reason: tooLong });
    return null;
  }

  // Para adaptar y verificar, cada inciso lleva delante la consigna de su bloque: así se entiende solo y la adaptación
  // puede repetirla sin que el verificador lo tome como texto nuevo. La pantalla muestra el original con el bloque aparte.
  const work: Extraction = { ...ex, items: ex.items.map(withBlock) };

  // Planteo independiente de cada problema original, una sola vez para los 3 formatos.
  const originals = new Map<string, Promise<MathModel>>();
  for (const it of work.items) {
    if (it.kind === "problema") originals.set(it.id, modelProblem(fillMath(it.text, it.math)).catch(() => NOT_SOLVABLE));
  }

  // Un ajuste que no cambia nada en este práctico (números más simples sin problemas con texto) no le llega al modelo
  // ni marca la versión como "dificultad modificada": la pantalla avisa que no se aplicó.
  const { applied, notApplied } = applicableAdjustments(ex.items, ajustes);
  // Legibilidad del original tal como se ve: cada consigna de bloque una sola vez, no repetida en cada inciso.
  const blocks = [...new Set(ex.items.map((it) => blockInstruction(it.block)).filter(Boolean))];
  const before = textReadability([...blocks, ...ex.items.map((it) => it.text)]);
  // Razonamiento disminuido: sus apoyos van en la versión propia y en las versiones base que eligió el profe. La versión
  // propia sale solo si se pidió y quedó algún apoyo para aplicar. "Menos ítems" cambia todas las versiones.
  const reasoning = applied.filter(isReasoning);
  const targets = reasoning.length > 0 ? (options.razonamiento_en ?? []) : [];
  const run: Format[] = [...BASE_FORMATS, ...(targets.includes("razonamiento") ? (["razonamiento"] as const) : [])];
  const forFormat = (f: Format) => applied.filter((a) => !isReasoning(a) || targets.includes(f));
  const intereses = options.intereses ?? [];
  const formats = await Promise.all(run.map((f) => adaptFormat(work, f, originals, onEvent, forFormat(f), intereses, before)));
  const answerKey = await buildAnswerKey(ex, originals);
  const used = [...new Set(formats.flatMap((f) => f.ajustes))];
  const result: AdaptResult = {
    extraction: ex,
    ajustes: used,
    no_aplicados: notApplied,
    dificultad_modificada: used.length > 0,
    intereses,
    razonamiento_en: targets,
    omitted,
    answerKey,
    formats,
    ms: { extract: extractMs, total: Date.now() - t0 },
  };
  onEvent({ stage: "listo", result });
  return result;
}
