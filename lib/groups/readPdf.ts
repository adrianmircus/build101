import type { ReadPdfResponse } from "@/lib/contract";

// Same switch as lib/groups/generate.ts: without the real agent, a sample reading.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

// Sends the teacher's PDF or photos to the agent, which transcribes the exercises. Errors carry a message to show as-is.
export async function readExercisesPdf(files: File[]): Promise<ReadPdfResponse> {
  if (USE_MOCK) return mock(files);
  const body = new FormData();
  for (const file of files) body.append("file", file);
  const response = await fetch("/api/assessments/read-pdf", { method: "POST", body });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error ?? "No pudimos leer los archivos. Reintentá.");
  return json as ReadPdfResponse;
}

// Does not read the file: it only shows where the transcription will go.
async function mock(files: File[]): Promise<ReadPdfResponse> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const name = files.map((f) => f.name).join(", ");
  return {
    name,
    original: `[Ejercicios de ejemplo leídos de ${name}]\n\n1) Resolvé: $3x + 5 = 20$\n\n2) Resolvé: $2(x - 4) = 10$`,
    doubts: [],
  };
}
