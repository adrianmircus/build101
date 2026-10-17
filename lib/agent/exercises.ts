import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AcceptedType } from "@/lib/adapter/upload";
import { withFallback } from "./client";
import { AgentError } from "./generate";

const Output = z.object({
  original: z.string(),
  doubts: z.array(z.string()),
});

const SYSTEM = `You read a math worksheet or exam (práctico o parcial) that a high school teacher in Uruguay uploaded as a PDF, and transcribe its exercises as text. The teacher reviews your transcription, and then it is adapted for students with different profiles.

Rules:
- Transcribe faithfully: same numbering, same numbers, same wording, same order. Keep the instructions that go with the exercises.
- Don't solve anything, don't fix mistakes in the document and don't add exercises, hints or explanations.
- Leave out what isn't part of the exercises: the school header, name and date fields, grading tables, page numbers.
- Write math in LaTeX ($...$ inline, $$...$$ for blocks). The result is markdown with one exercise per paragraph, each starting with its number as in the document (for example "1)" or "Ejercicio 1.").
- Write tables as markdown tables (a header row, then |---|), keeping empty cells empty.
- If there is a figure or graph, put it where it goes as "[Figura: short description of what it shows]".
- If something is illegible or could be read two ways, transcribe your best reading and add a short note to "doubts" saying which exercise and what is unclear, in Rioplatense Spanish. If everything is clear, leave "doubts" empty.
- Write in Spanish, as the document does.`;

// A PDF or a photo of the teacher's assessment, already in base64.
export type ExercisesFile = { mediaType: AcceptedType; data: string };

export async function readExercisesPdf(files: ExercisesFile[]): Promise<{ original: string; doubts: string[] }> {
  const documents: Anthropic.Beta.BetaContentBlockParam[] = files.map((f) =>
    f.mediaType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: f.data },
          title: "Práctico o parcial del docente",
        }
      : { type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } },
  );
  const response = await withFallback(({ client, model, extra }) =>
    client.beta.messages.parse({
      model,
      ...extra,
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...documents,
            {
              type: "text",
              text:
                files.length > 1
                  ? "Transcribí los ejercicios de estos archivos, en orden: son páginas del mismo práctico o parcial."
                  : "Transcribí los ejercicios de este documento.",
            },
          ],
        },
      ],
    }),
  );

  if (response.stop_reason === "refusal") {
    throw new AgentError("La IA no pudo leer estos archivos. Probá con otros o escribí los ejercicios a mano.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AgentError("La lectura del PDF llegó incompleta. Probá de nuevo.");
  }

  const original = response.parsed_output.original.trim();
  if (!original) throw new AgentError("No encontramos ejercicios en este PDF.");
  return { original, doubts: response.parsed_output.doubts.map((d) => d.trim()).filter(Boolean) };
}
