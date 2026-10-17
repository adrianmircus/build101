import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SyllabusUnit } from "@/lib/contract";
import { FALLBACK, getClient, MODEL } from "./client";
import { AgentError } from "./generate";

const Output = z.object({
  units: z.array(z.object({ title: z.string(), contents: z.string() })),
});

const SYSTEM = `You read the official syllabus (programa oficial) of a high school course in Uruguay and split it into units, one per section of the document, so a teacher can review them.

Rules:
- Follow the document's own sections and their order. If it has numbered units, use those.
- Include only the sections that describe what is taught (units, topics, contents). Skip purely administrative ones such as bibliography.
- "title": the section's title as it appears in the document.
- "contents": the topics of that section, faithful to the document, as a short list with one topic per line starting with "- ". Keep math in LaTeX ($...$).
- Don't add topics, examples or explanations that aren't in the document.
- Write in Spanish, as the document does.`;

export async function extractUnits(fileId: string): Promise<SyllabusUnit[]> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "file", file_id: fileId }, title: "Programa oficial" },
          { type: "text", text: "Armá las unidades de este programa, una por sección." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new AgentError("La IA no pudo leer este programa. Probá con otro PDF.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AgentError("La lectura del programa llegó incompleta. Probá de nuevo.");
  }

  const units = response.parsed_output.units
    .map((u) => ({ title: u.title.trim(), contents: u.contents.trim() }))
    .filter((u) => u.title || u.contents);
  if (units.length === 0) {
    throw new AgentError("No encontramos unidades en este PDF. ¿Es el programa de la materia?");
  }
  return units;
}
