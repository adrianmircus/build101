// Pipeline: extraer (Claude) → adaptar los 3 formatos en paralelo (Claude) → verificar (código + planteo independiente)
// → reintentar una vez los ejercicios que fallan → marcar para revisión lo que siga fallando.
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getClient, MODEL } from "@/lib/agent/client";
import { fmt, stepSet, type MathStep, type SolutionSet } from "./equivalence";
import { EXTRACT_SYSTEM, MODEL_SYSTEM, adaptSystem, needsSupport } from "./adapt-prompts";
import {
  AdaptationSchema,
  AdaptationWithSupportSchema,
  ExtractionSchema,
  FORMATS,
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
  applicableAdjustments,
  checkItem,
  fillMath,
  HEADER_ID,
  headerIssues,
  keepItems,
  retryIssues,
  scopeIssue,
  textReadability,
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
  readability: { before: number | null; after: number | null }; // de toda la versión; null: no aplica
  ms: number;
}

export interface AdaptResult {
  extraction: Extraction; // con menos_items, solo los ejercicios que eligió el profe
  ajustes: Adjustment[]; // los que se aplicaron
  no_aplicados: NotApplied[]; // los que el profe pidió pero no cambian nada en este práctico
  dificultad_modificada: boolean; // la pantalla tiene que mostrarlo en cada versión
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
  retry?: { previous: Adaptation; failures: { id: string; issues: string[] }[] },
): Promise<Adaptation> {
  let user = `Práctico:\n${practicoForPrompt(ex)}`;
  if (retry) {
    const list = retry.failures
      .map((f) => `- ${f.id === HEADER_ID ? "Título e indicaciones generales" : `Ejercicio ${f.id}`}: ${f.issues.join("; ")}`)
      .join("\n");
    user += `\n\nTu versión anterior:\n${JSON.stringify(retry.previous)}\n\nEl verificador encontró estos problemas. Corregí solo estos ejercicios y devolvé la versión completa:\n${list}`;
  }
  // Con ajustes de dificultad, cada ejercicio trae además sus apoyos (support).
  const schema = needsSupport(ajustes) ? AdaptationWithSupportSchema : AdaptationSchema;
  const res = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: adaptSystem(format, ajustes),
    output_config: { effort: "medium", format: zodOutputFormat(schema) },
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new PipelineError("No pudimos adaptar el práctico. Probá de nuevo.");
  return res.parsed_output;
}

export async function modelProblem(text: string): Promise<MathModel> {
  const res = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: MODEL_SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(MathModelSchema) },
    messages: [{ role: "user", content: text }],
  });
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

async function adaptFormat(
  ex: Extraction,
  format: Format,
  originals: Map<string, Promise<MathModel>>,
  onEvent: (e: AdaptEvent) => void,
  ajustes: Adjustment[],
): Promise<FormatResult> {
  const t0 = Date.now();
  onEvent({ stage: "adaptando", format });
  let adaptation = await adaptCall(ex, format, ajustes);

  onEvent({ stage: "verificando", format });
  let checks = await checkAll(ex, adaptation, format, originals, ajustes);
  let header = headerIssues(ex, adaptation);

  // Los ejercicios cuyo único problema es una lectura dudosa del original no se reintentan: van a revisión.
  const failures = checks.map((c) => ({ id: c.id, issues: retryIssues(c) })).filter((f) => f.issues.length > 0);
  const retried = failures.map((f) => f.id);
  if (failures.length > 0 || header.length > 0) {
    onEvent({ stage: "reintentando", format });
    const headerFailure = header.length > 0 ? [{ id: HEADER_ID, issues: header }] : [];
    const fixed = await adaptCall(ex, format, ajustes, { previous: adaptation, failures: [...headerFailure, ...failures] });
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
    // Sobre el texto de toda la versión, no un promedio por ejercicio: un inciso de tres palabras no da un índice que sirva.
    readability: {
      before: textReadability(ex.items.map((it) => it.text)),
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
      if (it.kind === "ecuacion") equation = it.math.find((m) => m.role === "equation")?.mathjs ?? null;
      if (it.kind === "problema") {
        const m = await originals.get(it.id);
        if (m?.solvable) equation = m.equation;
      }
      // Sin raíces en el rango revisado no quiere decir "sin solución": puede estar fuera del rango. Se muestra "—".
      const found = equation ? stepSet(eqStep(equation)) : null;
      const set = found && (found === "all" || found.length > 0) ? found : null;
      return { id: it.id, solution: set ? fmt(set) : "—", set };
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
  const kept = ajustes.includes("menos_items") ? keepItems(extracted.items, options.keep_items) : extracted.items;
  const omitted = extracted.items.filter((it) => !kept.includes(it)).map((it) => it.id);
  if (extracted.items.length > 0 && kept.length === 0) {
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

  // Planteo independiente de cada problema original, una sola vez para los 3 formatos.
  const originals = new Map<string, Promise<MathModel>>();
  for (const it of ex.items) {
    if (it.kind === "problema") originals.set(it.id, modelProblem(fillMath(it.text, it.math)).catch(() => NOT_SOLVABLE));
  }

  // Un ajuste que no cambia nada en este práctico (números más simples sin problemas con texto) no le llega al modelo
  // ni marca la versión como "dificultad modificada": la pantalla avisa que no se aplicó.
  const { applied, notApplied } = applicableAdjustments(ex.items, ajustes);
  const formats = await Promise.all(FORMATS.map((f) => adaptFormat(ex, f, originals, onEvent, applied)));
  const answerKey = await buildAnswerKey(ex, originals);
  const result: AdaptResult = {
    extraction: ex,
    ajustes: applied,
    no_aplicados: notApplied,
    dificultad_modificada: applied.length > 0,
    omitted,
    answerKey,
    formats,
    ms: { extract: extractMs, total: Date.now() - t0 },
  };
  onEvent({ stage: "listo", result });
  return result;
}
