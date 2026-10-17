import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getClient, MODEL } from "./client";
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

export async function readExercisesPdf(base64: string): Promise<{ original: string; doubts: string[] }> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
            title: "Práctico o parcial del docente",
          },
          { type: "text", text: "Transcribí los ejercicios de este documento." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new AgentError("La IA no pudo leer este PDF. Probá con otro archivo o escribí los ejercicios a mano.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AgentError("La lectura del PDF llegó incompleta. Probá de nuevo.");
  }

  const original = response.parsed_output.original.trim();
  if (!original) throw new AgentError("No encontramos ejercicios en este PDF.");
  return { original, doubts: response.parsed_output.doubts.map((d) => d.trim()).filter(Boolean) };
}
