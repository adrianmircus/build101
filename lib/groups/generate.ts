import type { GenerationRequest, GenerationResponse } from "@/lib/contract";
import { syllabusForAI } from "@/lib/syllabus/store";
import { getData, updateVersion } from "./store";
import { versionLabel } from "./versions";

// Until Dev B has POST /api/generate, the front uses sample responses.
// To connect the real agent: NEXT_PUBLIC_USE_MOCK=false in .env.local.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

async function requestVersion(request: GenerationRequest): Promise<GenerationResponse> {
  if (USE_MOCK) return mock(request);
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`The agent responded ${response.status}`);
  return response.json();
}

// Does not invent adaptations: it only marks where each profile agent's output will go.
async function mock(request: GenerationRequest): Promise<GenerationResponse> {
  await new Promise((resolve) => setTimeout(resolve, 1000 + request.profiles.length * 900));
  const label = versionLabel(request.profiles);
  const interests = request.interests ?? [];
  return {
    profiles: request.profiles,
    content: `[Versión de ejemplo: ${label}]\n\n${request.original}`,
    changes: [
      ...(request.profiles.length > 0
        ? [
            {
              what: `Cambio de ejemplo para ${label}`,
              why: "Acá va cada cambio que haga el agente del perfil, con su justificación y la fuente.",
            },
          ]
        : []),
      ...(interests.length > 0
        ? [
            {
              what: `Contexto de ejemplo ambientado en ${interests.join(", ")}`,
              why: `Para hacerlo más atractivo según los gustos del grupo: ${interests.join(", ")}.`,
            },
          ]
        : []),
    ],
  };
}

const inFlight = new Set<string>();

// Generates every pending or failed version in parallel. Each one is saved as soon as it arrives,
// so the screen shows them one by one.
export async function generatePending(assessmentId: string) {
  const assessment = getData().assessments.find((a) => a.id === assessmentId);
  if (!assessment) return;
  const syllabus = syllabusForAI();
  await Promise.all(
    assessment.versions.map(async (version, index) => {
      if (version.status !== "pending" && version.status !== "error") return;
      const key = `${assessmentId}:${index}`;
      if (inFlight.has(key)) return;
      inFlight.add(key);
      updateVersion(assessmentId, index, { status: "generating" });
      try {
        const { content, changes } = await requestVersion({
          type: assessment.type,
          topic: assessment.topic,
          original: assessment.original,
          profiles: version.profiles,
          interests: version.interests,
          syllabus,
        });
        updateVersion(assessmentId, index, { status: "ready", content, changes, approved: false });
      } catch {
        updateVersion(assessmentId, index, { status: "error" });
      } finally {
        inFlight.delete(key);
      }
    }),
  );
}
