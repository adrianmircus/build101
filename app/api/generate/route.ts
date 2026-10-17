import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AgentError, generateVersion } from "@/lib/agent/generate";
import { PROFILES } from "@/lib/profiles";

// Validates GenerationRequest (lib/contract.ts) before spending an AI call.
const RequestBody = z.object({
  type: z.enum(["worksheet", "exam"]),
  topic: z.string().trim().min(1).max(300),
  original: z.string().trim().min(1).max(50_000),
  profiles: z.array(z.string().refine((id) => PROFILES.some((p) => p.id === id))).max(10),
  interests: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
  syllabus: z
    .object({
      subject: z.string().max(200),
      course: z.string().max(200),
      units: z.array(z.object({ title: z.string().max(300), contents: z.string().max(20_000) })).max(50),
      pdfFileId: z.string().max(200).optional(),
    })
    .optional(),
});

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) {
    return error("El pedido no es válido: revisá el tema, los ejercicios y los perfiles.", 400);
  }

  try {
    return Response.json(await generateVersion(parsed.data));
  } catch (e) {
    if (e instanceof AgentError) return error(e.message, 502);
    if (e instanceof Anthropic.AuthenticationError) return error("Falta configurar la API key de la IA.", 500);
    if (e instanceof Anthropic.RateLimitError) return error("La IA está saturada. Esperá unos segundos y reintentá.", 429);
    if (e instanceof Anthropic.NotFoundError) {
      return error("No encontramos el PDF del temario. Volvé a subirlo en Mi materia.", 502);
    }
    if (e instanceof Anthropic.APIError) return error(`La IA respondió con un error (${e.status}). Reintentá.`, 502);
    console.error(e);
    return error("No pudimos generar esta versión. Reintentá.", 500);
  }
}
