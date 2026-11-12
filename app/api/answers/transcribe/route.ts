import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AgentError } from "@/lib/agent/generate";
import { transcribeAnswer } from "@/lib/agent/transcribe";
import { cutShort, deadline } from "@/lib/agent/client";
import { aiGate } from "@/lib/server/auth/ai-gate";

// Validates TranscribeRequest (lib/contract.ts) before spending an AI call.
const RequestBody = z.object({
  exercise: z.string().max(5_000),
  transcript: z.string().trim().min(1).max(5_000),
});

// The AI call has 50 s (deadline below); the rest is margin to answer.
export const maxDuration = 60;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  // Who is asking is decided before anything is read or any provider is called (F2-3).
  const refused = await aiGate();
  if (refused) return refused;

  const body = await request.json().catch(() => null);
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) return error("No escuchamos nada para pasar a notación. Probá dictar de nuevo.", 400);

  const signal = deadline(request, 50);
  try {
    return Response.json(await transcribeAnswer(parsed.data, signal));
  } catch (e) {
    const cut = cutShort(e, signal);
    if (cut) return error(cut.message, cut.status);
    if (e instanceof AgentError) return error(e.message, 502);
    if (e instanceof Anthropic.AuthenticationError) return error("Falta configurar la API key de la IA.", 500);
    if (e instanceof Anthropic.RateLimitError) return error("La IA está saturada. Esperá unos segundos y reintentá.", 429);
    if (e instanceof Anthropic.APIError) return error(`La IA respondió con un error (${e.status}). Reintentá.`, 502);
    console.error(e);
    return error("No pudimos pasar tu respuesta a notación. Reintentá.", 500);
  }
}
