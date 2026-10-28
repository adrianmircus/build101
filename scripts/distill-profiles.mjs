// Distills each profile's source documents into a DRAFT of adaptations, each with its source and page.
// The team reviews the draft and approves it by copying it to data/profiles/<id>.md: the agent only reads that file.
//
//   npm run profiles:distill                            every profile with files in data/profiles/<id>/sources/
//   npm run profiles:distill -- adhd asd                only those profiles
//   npm run profiles:distill -- adhd --materia fisica   for another subject (matematica by default)
//
// The sources are the team's files in sources/ and, if the research agent ran (scripts/research-profiles.mjs),
// the pages it read in sources/web/.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

// Same setup as lib/agent/client.ts: with OPENROUTER_API_KEY everything goes through OpenRouter's
// Anthropic-compatible endpoint. Own variables, so inherited ANTHROPIC_* ones don't override them.
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
export const FOLDER = path.join(process.cwd(), "data", "profiles");
const EXTENSIONS = [".pdf", ".md", ".txt"];
// Where the research agent leaves the pages it read, and the index with each page's URL.
export const WEB_FOLDER = "web";
export const WEB_INDEX = "fuentes.json";

// The subject is a parameter: its name in the prompt (English, like the rest of it) and in the console.
export const SUBJECTS = {
  matematica: { prompt: "math", label: "Matemática" },
  fisica: { prompt: "physics", label: "Física" },
  quimica: { prompt: "chemistry", label: "Química" },
};

const CATEGORIES = ["Enunciado", "Formato visual", "Estructura", "Instrucciones", "Tiempo", "Forma de respuesta"];

const Output = z.object({
  title: z.string(),
  adaptations: z.array(
    z.object({
      category: z.enum(CATEGORIES),
      adaptation: z.string(),
      page: z.number().int().nullable(),
      quote: z.string(),
      contradicts: z.string().nullable(),
    }),
  ),
});

const system = (subject) => `You read a source document (a guide, paper or official recommendation) about a learning profile and extract the adaptations it recommends for written ${subject} assessments (worksheets and exams) for high school students.

Rules:
- Only adaptations the document states explicitly. Don't complete with your own knowledge, even if it seems right: a team will cite these in public.
- Each adaptation must be actionable on a written assessment: what to change in the statement, the visual format, the structure, the instructions, the time, or the way the student answers.
- Skip clinical or diagnostic content, and recommendations that don't apply to a written assessment (classroom management, medication, family).
- "page": the page number where it appears in the document, or null if the document has no pages.
- "quote": a short verbatim quote from the document that backs the adaptation, in its original language.
- "contradicts": if the user lists the adaptations already approved for this profile and this one contradicts one of them, that approved adaptation, copied as it is written; otherwise null. Never leave an adaptation out because it contradicts: a specialist decides.
- "title": the document's title as it appears in it.
- Write "adaptation" in Rioplatense Spanish, short and concrete.
- If the document recommends nothing applicable, return an empty list.`;

// The model and client to call. `direct` skips OpenRouter: the research agent needs Anthropic's web tools.
// `model` picks another model on Anthropic's API (Opus by default).
export function connect({ direct = false, model = "claude-opus-5-5" } = {}) {
  if (OPENROUTER_KEY && !direct) {
    return {
      client: new Anthropic({ baseURL: "https://openrouter.ai/api", authToken: OPENROUTER_KEY, apiKey: null }),
      model: process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5",
      // Server-side model fallback only exists on the Anthropic API: OpenRouter rejects `fallbacks` with a 400.
      extra: {},
    };
  }
  return {
    client: new Anthropic(),
    model,
    extra: { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
  };
}

// One line per call with its tokens, never its content (same idea as lib/agent/client.ts).
export function usageLine(usage) {
  if (!usage) return "sin datos de uso";
  const parts = [
    `entrada ${usage.input_tokens}`,
    `caché leída ${usage.cache_read_input_tokens ?? 0}`,
    `caché escrita ${usage.cache_creation_input_tokens ?? 0}`,
    `salida ${usage.output_tokens}`,
  ];
  const tools = usage.server_tool_use;
  if (tools) parts.push(`búsquedas ${tools.web_search_requests ?? 0}`, `lecturas ${tools.web_fetch_requests ?? 0}`);
  return `tokens: ${parts.join(", ")}`;
}

// Profile ids and --materia from the command line, plus any `extra` options of the calling script.
// Without ids, every folder with a sources/ subfolder.
export function readArgs(argv = process.argv.slice(2), extra = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { materia: { type: "string", default: "matematica" }, ...extra },
  });
  if (!Object.hasOwn(SUBJECTS, values.materia)) {
    throw new Error(`No conozco la materia "${values.materia}". Opciones: ${Object.keys(SUBJECTS).join(", ")}.`);
  }
  const ids =
    positionals.length > 0
      ? positionals
      : readdirSync(FOLDER, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && existsSync(path.join(FOLDER, entry.name, "sources")))
          .map((entry) => entry.name);
  return { ids, subject: values.materia, values };
}

// The team's files, then the pages the research agent read.
export function sourceFiles(id) {
  const folders = [path.join(FOLDER, id, "sources"), path.join(FOLDER, id, "sources", WEB_FOLDER)];
  return folders.flatMap((folder) => {
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((name) => EXTENSIONS.includes(path.extname(name).toLowerCase()))
      .sort()
      .map((name) => path.join(folder, name));
  });
}

// URL, title and date of each page in sources/web/, by file name.
export function webIndex(id) {
  const file = path.join(FOLDER, id, "sources", WEB_FOLDER, WEB_INDEX);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

// The heading of the approved file, e.g. "ADHD (Attention-deficit/hyperactivity disorder)".
export function profileName(id) {
  const file = path.join(FOLDER, `${id}.md`);
  if (!existsSync(file)) return id;
  const heading = readFileSync(file, "utf8").match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : id;
}

// What's already approved, so the draft can flag what contradicts it. Null if there's no approved file.
function approvedText(id) {
  const file = path.join(FOLDER, `${id}.md`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function documentBlock(file) {
  if (path.extname(file).toLowerCase() === ".pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: readFileSync(file).toString("base64") },
      title: path.basename(file),
    };
  }
  return {
    type: "document",
    source: { type: "text", media_type: "text/plain", data: readFileSync(file, "utf8") },
    title: path.basename(file),
  };
}

// One call per file: stays under the request size limit and ties each adaptation to its document.
export async function distillFile(api, file, profile, subject, approved) {
  const ask = `Extraé las adaptaciones que recomienda este documento para estudiantes con: ${profile}.`;
  const response = await api.client.beta.messages.parse({
    model: api.model,
    max_tokens: 16000,
    ...api.extra,
    output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
    system: system(SUBJECTS[subject].prompt),
    messages: [
      {
        role: "user",
        content: [
          documentBlock(file),
          {
            type: "text",
            text: approved
              ? `${ask}\n\nAdaptaciones ya aprobadas para este perfil (solo para marcar contradicciones):\n\n${approved}`
              : ask,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("la IA no quiso leer este documento");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new Error("la respuesta llegó incompleta");
  return { ...response.parsed_output, usage: response.usage };
}

// sources: [{ file, title, url?, adaptations }]
export function draftMarkdown(id, profile, sources, subject = "matematica") {
  const lines = [
    `# ${profile}`,
    "",
    "<!--",
    `BORRADOR generado por npm run profiles:distill (${SUBJECTS[subject].label}). El agente NO lo usa.`,
    `Revisalo (borrá lo que no aplique, corregí lo que haga falta) y aprobalo copiándolo a data/profiles/${id}.md.`,
    "-->",
  ];

  const all = sources.flatMap((source, i) => source.adaptations.map((a) => ({ ...a, ref: `F${i + 1}` })));
  const cite = (a) => `${a.page === null ? `[${a.ref}]` : `[${a.ref}], p. ${a.page}`}: "${a.quote}"`;

  const contradictions = all.filter((a) => a.contradicts);
  if (contradictions.length > 0) {
    lines.push("", "## ⚠ Contradice lo aprobado", "", "Un especialista decide cuál queda antes de aprobar el borrador.");
    for (const a of contradictions) lines.push(`- ${a.adaptation} (Fuente: ${cite(a)}). Aprobado hoy: "${a.contradicts}"`);
  }

  lines.push("", "## Adaptaciones");
  for (const category of CATEGORIES) {
    const items = all.filter((a) => a.category === category);
    if (items.length === 0) continue;
    lines.push("", `### ${category}`);
    for (const a of items) lines.push(`- ${a.contradicts ? "⚠ " : ""}${a.adaptation} (Fuente: ${cite(a)})`);
  }

  lines.push("", "## Fuentes");
  sources.forEach((source, i) => {
    const where = source.url ? `${source.url}, leída por el agente investigador` : `archivo: ${source.file}`;
    lines.push(`- [F${i + 1}] ${source.title} (${where})`);
  });
  return `${lines.join("\n")}\n`;
}

// Reads every source of one profile and writes its draft. Returns false if there was nothing to write.
export async function distillProfile(api, id, subject) {
  const files = sourceFiles(id);
  if (files.length === 0) {
    console.log(`· ${id}: no hay archivos en data/profiles/${id}/sources/ (.pdf, .md o .txt). Lo salteo.`);
    return false;
  }

  const profile = profileName(id);
  const approved = approvedText(id);
  const web = webIndex(id);
  const sources = [];
  for (const file of files) {
    const name = path.basename(file);
    const page = path.basename(path.dirname(file)) === WEB_FOLDER ? web[name] : undefined;
    process.stdout.write(`· ${id}: leyendo ${page ? `${WEB_FOLDER}/` : ""}${name}… `);
    try {
      const { title, adaptations, usage } = await distillFile(api, file, profile, subject, approved);
      sources.push({ file: name, title: title.trim() || page?.title || name, url: page?.url, adaptations });
      console.log(`${adaptations.length} adaptaciones (${usageLine(usage)})`);
    } catch (e) {
      console.log(`error: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (sources.length === 0) {
    console.log(`· ${id}: no se pudo leer ninguna fuente, no escribo borrador.`);
    return false;
  }
  const draft = path.join(FOLDER, `${id}.draft.md`);
  const replaced = existsSync(draft);
  writeFileSync(draft, draftMarkdown(id, profile, sources, subject));
  console.log(`· ${id}: ${replaced ? "reemplacé" : "escribí"} data/profiles/${id}.draft.md. Revisalo y pasalo a ${id}.md.`);
  return true;
}

async function main() {
  const { ids, subject } = readArgs();
  if (ids.length === 0) {
    console.log("No hay fuentes para destilar. Dejá los archivos en data/profiles/<perfil>/sources/.");
    return;
  }
  const api = connect();
  for (const id of ids) await distillProfile(api, id, subject);
}

// Only when run as a script: scripts/research-profiles.mjs and the tests import these functions.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
