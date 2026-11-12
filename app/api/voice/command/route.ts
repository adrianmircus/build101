import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AgentError } from "@/lib/agent/generate";
import { interpretCommand } from "@/lib/agent/voiceCommand";
import { cutShort, deadline } from "@/lib/agent/client";
import { aiGate } from "@/lib/server/auth/ai-gate";

// Validates VoiceCommandRequest (lib/contract.ts) before spending an AI call.
const RequestBody = z.object({
  heard: z.string().trim().min(1).max(500),
  commands: z
    .array(z.object({ id: z.string().min(1).max(100), label: z.string().min(1).max(200) }))
    .min(1)
    .max(100),
});

// The AI call has 25 s (deadline below); the rest is margin to answer.
export const maxDuration = 30;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  // Who is asking is decided before anything is read or any provider is called (F2-3).
  const refused = await aiGate();
  if (refused) return refused;

  const body = await request.json().catch(() => null);
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) return error("No escuchamos ningún comando. Probá de nuevo.", 400);

  const signal = deadline(request, 25);
  try {
    return Response.json(await interpretCommand(parsed.data, signal));
  } catch (e) {
    const cut = cutShort(e, signal);
    if (cut) return error(cut.message, cut.status);
    if (e instanceof AgentError) return error(e.message, 502);
    if (e instanceof Anthropic.AuthenticationError) return error("Falta configurar la API key de la IA.", 500);
    if (e instanceof Anthropic.RateLimitError) return error("La IA está saturada. Esperá unos segundos y reintentá.", 429);
    if (e instanceof Anthropic.APIError) return error(`La IA respondió con un error (${e.status}). Reintentá.`, 502);
    console.error(e);
    return error("No pudimos interpretar el comando. Reintentá.", 500);
  }
}
