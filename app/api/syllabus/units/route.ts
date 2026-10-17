import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AgentError } from "@/lib/agent/generate";
import { extractUnits } from "@/lib/agent/syllabus";
import type { SyllabusUnitsResponse } from "@/lib/contract";

// Validates SyllabusUnitsRequest (lib/contract.ts).
const RequestBody = z.object({ fileId: z.string().trim().min(1).max(200) });

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// The agent reads the syllabus PDF and proposes one unit per section. The teacher reviews and confirms them.
export async function POST(request: Request) {
  const parsed = RequestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Falta el PDF del programa.", 400);

  try {
    const response: SyllabusUnitsResponse = { units: await extractUnits(parsed.data.fileId) };
    return Response.json(response);
  } catch (e) {
    if (e instanceof AgentError) return error(e.message, 502);
    if (e instanceof Anthropic.AuthenticationError) return error("Falta configurar la API key de la IA.", 500);
    if (e instanceof Anthropic.NotFoundError) return error("No encontramos el PDF. Volvé a subirlo.", 502);
    if (e instanceof Anthropic.RateLimitError) return error("La IA está saturada. Esperá unos segundos y reintentá.", 429);
    if (e instanceof Anthropic.APIError) return error(`La IA respondió con un error (${e.status}). Reintentá.`, 502);
    console.error(e);
    return error("No pudimos leer el programa. Reintentá.", 500);
  }
}
