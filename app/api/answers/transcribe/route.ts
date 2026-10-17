import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AgentError } from "@/lib/agent/generate";
import { transcribeAnswer } from "@/lib/agent/transcribe";

// Validates TranscribeRequest (lib/contract.ts) before spending an AI call.
const RequestBody = z.object({
  exercise: z.string().max(5_000),
  transcript: z.string().trim().min(1).max(5_000),
});

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) return error("No escuchamos nada para pasar a notación. Probá dictar de nuevo.", 400);

  try {
    return Response.json(await transcribeAnswer(parsed.data));
  } catch (e) {
    if (e instanceof AgentError) return error(e.message, 502);
    if (e instanceof Anthropic.AuthenticationError) return error("Falta configurar la API key de la IA.", 500);
    if (e instanceof Anthropic.RateLimitError) return error("La IA está saturada. Esperá unos segundos y reintentá.", 429);
    if (e instanceof Anthropic.APIError) return error(`La IA respondió con un error (${e.status}). Reintentá.`, 502);
    console.error(e);
    return error("No pudimos pasar tu respuesta a notación. Reintentá.", 500);
  }
}
