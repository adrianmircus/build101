import type { TranscribeRequest, TranscribeResponse } from "@/lib/contract";

// Same switch as lib/groups/generate.ts: the real agent with NEXT_PUBLIC_USE_MOCK=false in .env.local.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

// Throws an Error whose message can be shown as-is.
export async function transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
  if (USE_MOCK) return mock(request);
  const response = await fetch("/api/answers/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "No pudimos pasar tu respuesta a notación. Reintentá.");
  return body as TranscribeResponse;
}

// Doesn't convert anything: it returns the dictation as-is, so the flow can be tried without an API key.
async function mock({ transcript }: TranscribeRequest): Promise<TranscribeResponse> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  return {
    answer: transcript,
    readback: transcript,
    doubts: ["[Ejemplo] Acá la IA te pregunta lo que se puede leer de dos formas."],
  };
}
