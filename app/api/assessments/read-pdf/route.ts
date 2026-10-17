import Anthropic from "@anthropic-ai/sdk";
import { uploadIssue, type AcceptedType } from "@/lib/adapter/upload";
import { readExercisesPdf } from "@/lib/agent/exercises";
import { AgentError } from "@/lib/agent/generate";
import type { ReadPdfResponse } from "@/lib/contract";

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// The agent reads the teacher's PDF or photos and transcribes the exercises. The files go straight to the AI and
// aren't stored. Same limits as the adapter (lib/adapter/upload.ts): up to 4 files and 4 MB, under Vercel's cap.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("file") ?? []).filter((f): f is File => f instanceof File);
  if (files.length === 0) return error("No llegó ningún archivo.", 400);
  const issue = uploadIssue(files);
  if (issue) return error(issue, files.length > 4 ? 400 : 413);

  try {
    const read = await readExercisesPdf(
      await Promise.all(
        files.map(async (f) => ({
          mediaType: f.type as AcceptedType,
          data: Buffer.from(await f.arrayBuffer()).toString("base64"),
        })),
      ),
    );
    const response: ReadPdfResponse = { name: files.map((f) => f.name).join(", "), ...read };
    return Response.json(response);
  } catch (e) {
    if (e instanceof AgentError) return error(e.message, 502);
    if (e instanceof Anthropic.AuthenticationError) return error("Falta configurar la API key de la IA.", 500);
    if (e instanceof Anthropic.RateLimitError) return error("La IA está saturada. Esperá unos segundos y reintentá.", 429);
    if (e instanceof Anthropic.APIError) return error(`La IA respondió con un error (${e.status}). Reintentá.`, 502);
    console.error(e);
    return error("No pudimos leer los archivos. Reintentá.", 500);
  }
}
