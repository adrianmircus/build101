import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "@/lib/agent/client";
import type { SyllabusPdfResponse } from "@/lib/contract";

// Vercel cuts off bodies larger than 4.5 MB: leave some margin.
const MAX_BYTES = 4 * 1024 * 1024;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Uploads the syllabus PDF to the Files API once. The browser only stores the id.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return error("No llegó ningún archivo.", 400);
  if (file.type !== "application/pdf") return error("El archivo tiene que ser un PDF.", 400);
  if (file.size > MAX_BYTES) return error("El PDF pesa más de 4 MB. Probá con una versión más liviana.", 413);

  try {
    const uploaded = await getClient().files.upload({ file });
    const response: SyllabusPdfResponse = { fileId: uploaded.id, name: file.name };
    return Response.json(response);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return error("Falta configurar la API key de la IA.", 500);
    if (e instanceof Anthropic.APIError) return error(`No pudimos subir el PDF (${e.status}). Reintentá.`, 502);
    console.error(e);
    return error("No pudimos subir el PDF. Reintentá.", 500);
  }
}
