import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ResultsAnalysisRequest, ResultsAnalysisResponse } from "@/lib/contract";
import { getClient, MODEL } from "./client";
import { AgentError } from "./generate";

const Output = z.object({
  summary: z.string(),
  difficulties: z.array(z.object({ topic: z.string(), evidence: z.string() })),
  students: z.array(z.object({ ref: z.string(), summary: z.string() })),
});

// Fixed so it gets cached across requests: the results go in the user message.
const SYSTEM = `You help a high school (bachillerato) math teacher in Uruguay read the results of their group's worksheets and exams. The teacher marked each exercise of each student as correct, partial, wrong or blank, and tagged the type of mistake. Students appear only as pseudonyms (E1, E2…).

Rules:
- Describe ONLY patterns that are visible in the data: which exercises and topics cost the most, which types of mistakes repeat, and how each student did. Cite the evidence (exercise numbers, counts, grades).
- Don't diagnose, don't guess causes outside the data, and don't make clinical or learning-profile claims about anyone.
- Don't invent teaching strategies. You may say which exercises or topics are worth reviewing because the data shows they cost the most.
- "summary": two or three sentences about the whole group.
- "difficulties": the two to four main difficulties, each with "topic" (short) and "evidence".
- "students": one entry per pseudonym that has results, with "ref" exactly as given and a one or two sentence "summary". Mention strengths too, not only mistakes.
- Grades are on a 1 to 10 scale.
- Write in Rioplatense Spanish, clear and direct, addressed to the teacher ("vos").`;

const STATUS_TEXT = { correct: "bien", partial: "parcial", wrong: "mal", blank: "sin hacer" } as const;

function resultsText(request: ResultsAnalysisRequest): string {
  return request.assessments
    .map((a) => {
      const exercises = a.exercises.map((text, i) => `${i + 1}) ${text || "(sin texto)"}`).join("\n");
      const students = a.students
        .map((s) => {
          const marks = s.marks
            .map((m, i) =>
              m ? `Ej. ${i + 1}: ${STATUS_TEXT[m.status]}${m.errors.length ? ` (${m.errors.join(", ")})` : ""}` : null,
            )
            .filter(Boolean)
            .join("; ");
          return `- ${s.ref}: ${s.grade !== undefined ? `nota ${s.grade}` : "sin nota"}${marks ? ` · ${marks}` : ""}`;
        })
        .join("\n");
      return `<assessment type="${a.type === "exam" ? "parcial" : "práctico"}" topic="${a.topic}">\n<exercises>\n${exercises}\n</exercises>\n<results>\n${students}\n</results>\n</assessment>`;
    })
    .join("\n\n");
}

export async function analyzeResults(request: ResultsAnalysisRequest): Promise<ResultsAnalysisResponse> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
    system: SYSTEM,
    messages: [{ role: "user", content: `${resultsText(request)}\n\nAnalizá los resultados de este grupo.` }],
  });

  if (response.stop_reason === "refusal") {
    throw new AgentError("La IA no pudo analizar estos resultados. Probá de nuevo.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AgentError("La respuesta de la IA llegó incompleta. Probá de nuevo.");
  }

  // Only refs that were sent: the front maps them back to names.
  const refs = new Set(request.assessments.flatMap((a) => a.students.map((s) => s.ref)));
  const output = response.parsed_output;
  return { ...output, students: output.students.filter((s) => refs.has(s.ref)) };
}
