import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { analyzeResults } from "@/lib/agent/analyze";
import { AgentError } from "@/lib/agent/generate";
import { cutShort, deadline } from "@/lib/agent/client";
import { aiGate } from "@/lib/server/auth/ai-gate";

// Validates ResultsAnalysisRequest (lib/contract.ts). Refs are pseudonyms like "E3": a name can't fit.
const Mark = z
  .object({
    status: z.enum(["correct", "partial", "wrong", "blank"]),
    errors: z.array(z.string().trim().min(1).max(60)).max(10),
  })
  .nullable();

const RequestBody = z.object({
  assessments: z
    .array(
      z.object({
        type: z.enum(["worksheet", "exam"]),
        topic: z.string().trim().min(1).max(300),
        exercises: z.array(z.string().max(2_000)).min(1).max(40),
        students: z
          .array(
            z.object({
              ref: z.string().regex(/^E\d{1,3}$/),
              grade: z.number().int().min(1).max(10).optional(),
              marks: z.array(Mark).max(40),
            }),
          )
          .max(60),
      }),
    )
    .min(1)
    .max(20),
});

// The AI call has 110 s (deadline below); the rest is margin to answer.
export const maxDuration = 120;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  // Who is asking is decided before anything is read or any provider is called (F2-3).
  const refused = await aiGate();
  if (refused) return refused;

  const body = await request.json().catch(() => null);
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) return error("No hay resultados válidos para analizar.", 400);

  const signal = deadline(request, 110);
  try {
    return Response.json(await analyzeResults(parsed.data, signal));
  } catch (e) {
    const cut = cutShort(e, signal);
    if (cut) return error(cut.message, cut.status);
    if (e instanceof AgentError) return error(e.message, 502);
    if (e instanceof Anthropic.AuthenticationError) return error("Falta configurar la API key de la IA.", 500);
    if (e instanceof Anthropic.RateLimitError) return error("La IA está saturada. Esperá unos segundos y reintentá.", 429);
    if (e instanceof Anthropic.APIError) return error(`La IA respondió con un error (${e.status}). Reintentá.`, 502);
    console.error(e);
    return error("No pudimos analizar los resultados. Reintentá.", 500);
  }
}
