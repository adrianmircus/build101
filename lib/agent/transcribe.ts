import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { TranscribeRequest, TranscribeResponse } from "@/lib/contract";
import { getClient, MODEL } from "./client";
import { AgentError } from "./generate";

const Output = z.object({
  answer: z.string(),
  readback: z.string(),
  doubts: z.array(z.string()),
});

// Fixed so it gets cached across requests: the exercise and the dictation go in the user message.
const SYSTEM = `You help a high school (bachillerato) math student in Uruguay who has trouble writing (dysgraphia). They answer exam and worksheet exercises by dictating, and the browser's speech recognition turns their voice into text. That text is often literal and messy ("equis al cuadrado más tres equis", "raíz de dos", "menos cuatro sobre dos"). Your job is to write what they said in math notation so they can check it and save it as their answer.

Rules:
- Transcribe ONLY. Never correct, complete, simplify or solve. If what they said is wrong, it stays wrong: the teacher grades it, not you. Don't add steps, results or units they didn't say.
- Keep their words when they're explaining something rather than dictating math ("porque el dominio no puede ser negativo"): write them as text, cleaned of filler words ("eh", "este", "o sea") and speech-recognition noise, with math parts in notation.
- Notation must be readable as plain text, without LaTeX: use Unicode (x², x³, √, ·, −, ≤, ≥, ≠, π, |x|), "/" for fractions with parentheses when needed, and "=" between steps. Put each step they dictate on its own line.
- The exercise statement is only context to understand symbols and names (for example, if it uses f(x) or g). Never take an answer from it.
- "readback": the answer as it should be read aloud in Rioplatense Spanish, so the student can confirm it by ear ("equis al cuadrado más tres equis menos cuatro igual a cero").
- "doubts": when something can be written two ways and the dictation doesn't say which ("x más dos al cuadrado": (x + 2)² or x + 2²?), pick the most literal reading for "answer" and add a short question for the student in "doubts". Speech recognition errors you can't resolve go here too. Empty if there are none.
- If the dictation is empty or has nothing that answers anything, leave "answer" empty and explain it in "doubts".
- Write in Rioplatense Spanish, addressed to the student ("vos").`;

export async function transcribeAnswer(request: TranscribeRequest): Promise<TranscribeResponse> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Low: it's a transcription and the student is waiting for it.
    output_config: { effort: "low", format: betaZodOutputFormat(Output) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `<exercise>\n${request.exercise}\n</exercise>\n<dictation>\n${request.transcript}\n</dictation>\n\nEscribí en notación lo que dictó el estudiante.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new AgentError("No pudimos pasar tu respuesta a notación. Probá dictarla de nuevo.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AgentError("La respuesta llegó incompleta. Probá de nuevo.");
  }
  return response.parsed_output;
}
