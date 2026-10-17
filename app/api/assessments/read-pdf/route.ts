import Anthropic from "@anthropic-ai/sdk";
import { readExercisesPdf } from "@/lib/agent/exercises";
import { AgentError } from "@/lib/agent/generate";
import type { ReadPdfResponse } from "@/lib/contract";

// Vercel cuts off bodies larger than 4.5 MB: leave some margin.
const MAX_BYTES = 4 * 1024 * 1024;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// The agent reads the teacher's PDF and transcribes the exercises. The PDF goes straight to the AI and isn't stored.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return error("No llegó ningún archivo.", 400);
  if (file.type !== "application/pdf") return error("El archivo tiene que ser un PDF.", 400);
  if (file.size > MAX_BYTES) return error("El PDF pesa más de 4 MB. Probá con una versión más liviana.", 413);

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const response: ReadPdfResponse = { name: file.name, ...(await readExercisesPdf(base64)) };
    return Response.json(response);
  } catch (e) {
    if (e instanceof AgentError) return error(e.message, 502);
    if (e instanceof Anthropic.AuthenticationError) return error("Falta configurar la API key de la IA.", 500);
    if (e instanceof Anthropic.RateLimitError) return error("La IA está saturada. Esperá unos segundos y reintentá.", 429);
    if (e instanceof Anthropic.APIError) return error(`La IA respondió con un error (${e.status}). Reintentá.`, 502);
    console.error(e);
    return error("No pudimos leer el PDF. Reintentá.", 500);
  }
}
