// Distills each profile's source documents into a DRAFT of adaptations, each with its source and page.
// The team reviews the draft and approves it by copying it to data/profiles/<id>.md: the agent only reads that file.
//
//   npm run profiles:distill              every profile with files in data/profiles/<id>/sources/
//   npm run profiles:distill -- adhd asd  only those profiles
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Same setup as lib/agent/client.ts: with OPENROUTER_API_KEY everything goes through OpenRouter's
// Anthropic-compatible endpoint. Own variables, so inherited ANTHROPIC_* ones don't override them.
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = OPENROUTER_KEY ? process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5" : "claude-opus-5-5";
// Server-side model fallback only exists on the Anthropic API: OpenRouter rejects `fallbacks` with a 400.
const FALLBACK = OPENROUTER_KEY ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
const FOLDER = path.join(process.cwd(), "data", "profiles");
const EXTENSIONS = [".pdf", ".md", ".txt"];

const CATEGORIES = ["Enunciado", "Formato visual", "Estructura", "Instrucciones", "Tiempo", "Forma de respuesta"];

const Output = z.object({
  title: z.string(),
  adaptations: z.array(
    z.object({
      category: z.enum(CATEGORIES),
      adaptation: z.string(),
      page: z.number().int().nullable(),
      quote: z.string(),
    }),
  ),
});

const SYSTEM = `You read a source document (a guide, paper or official recommendation) about a learning profile and extract the adaptations it recommends for written math assessments (worksheets and exams) for high school students.

Rules:
- Only adaptations the document states explicitly. Don't complete with your own knowledge, even if it seems right: a team will cite these in public.
- Each adaptation must be actionable on a written assessment: what to change in the statement, the visual format, the structure, the instructions, the time, or the way the student answers.
- Skip clinical or diagnostic content, and recommendations that don't apply to a written assessment (classroom management, medication, family).
- "page": the page number where it appears in the document, or null if the document has no pages.
- "quote": a short verbatim quote from the document that backs the adaptation, in its original language.
- "title": the document's title as it appears in it.
- Write "adaptation" in Rioplatense Spanish, short and concrete.
- If the document recommends nothing applicable, return an empty list.`;

// Profile ids from the arguments, or every folder with a sources/ subfolder.
function profileIds() {
  const args = process.argv.slice(2);
  if (args.length > 0) return args;
  return readdirSync(FOLDER, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(FOLDER, entry.name, "sources")))
    .map((entry) => entry.name);
}

function sourceFiles(id) {
  const folder = path.join(FOLDER, id, "sources");
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => EXTENSIONS.includes(path.extname(name).toLowerCase()))
    .sort()
    .map((name) => path.join(folder, name));
}

// The heading of the approved file, e.g. "ADHD (Attention-deficit/hyperactivity disorder)".
function profileName(id) {
  const file = path.join(FOLDER, `${id}.md`);
  if (!existsSync(file)) return id;
  const heading = readFileSync(file, "utf8").match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : id;
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
async function distillFile(client, file, profile) {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          documentBlock(file),
          { type: "text", text: `Extraé las adaptaciones que recomienda este documento para estudiantes con: ${profile}.` },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("la IA no quiso leer este documento");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new Error("la respuesta llegó incompleta");
  return response.parsed_output;
}

function draftMarkdown(id, profile, sources) {
  const lines = [
    `# ${profile}`,
    "",
    "<!--",
    `BORRADOR generado por npm run profiles:distill. El agente NO lo usa.`,
    `Revisalo (borrá lo que no aplique, corregí lo que haga falta) y aprobalo copiándolo a data/profiles/${id}.md.`,
    "-->",
    "",
    "## Adaptaciones",
  ];

  for (const category of CATEGORIES) {
    const items = sources.flatMap((source, i) =>
      source.adaptations.filter((a) => a.category === category).map((a) => ({ ...a, ref: `F${i + 1}` })),
    );
    if (items.length === 0) continue;
    lines.push("", `### ${category}`);
    for (const a of items) {
      const where = a.page === null ? `[${a.ref}]` : `[${a.ref}], p. ${a.page}`;
      lines.push(`- ${a.adaptation} (Fuente: ${where}: "${a.quote}")`);
    }
  }

  lines.push("", "## Fuentes");
  sources.forEach((source, i) => lines.push(`- [F${i + 1}] ${source.title} (archivo: ${source.file})`));
  return `${lines.join("\n")}\n`;
}

async function main() {
  const client = OPENROUTER_KEY
    ? new Anthropic({ baseURL: "https://openrouter.ai/api", authToken: OPENROUTER_KEY, apiKey: null })
    : new Anthropic();
  const ids = profileIds();
  if (ids.length === 0) {
    console.log("No hay fuentes para destilar. Dejá los archivos en data/profiles/<perfil>/sources/.");
    return;
  }

  for (const id of ids) {
    const files = sourceFiles(id);
    if (files.length === 0) {
      console.log(`· ${id}: no hay archivos en data/profiles/${id}/sources/ (.pdf, .md o .txt). Lo salteo.`);
      continue;
    }

    const profile = profileName(id);
    const sources = [];
    for (const file of files) {
      const name = path.basename(file);
      process.stdout.write(`· ${id}: leyendo ${name}… `);
      try {
        const { title, adaptations } = await distillFile(client, file, profile);
        sources.push({ file: name, title: title.trim() || name, adaptations });
        console.log(`${adaptations.length} adaptaciones`);
      } catch (e) {
        console.log(`error: ${e instanceof Error ? e.message : e}`);
      }
    }

    if (sources.length === 0) {
      console.log(`· ${id}: no se pudo leer ninguna fuente, no escribo borrador.`);
      continue;
    }
    const draft = path.join(FOLDER, `${id}.draft.md`);
    const replaced = existsSync(draft);
    writeFileSync(draft, draftMarkdown(id, profile, sources));
    console.log(`· ${id}: ${replaced ? "reemplacé" : "escribí"} data/profiles/${id}.draft.md. Revisalo y pasalo a ${id}.md.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
