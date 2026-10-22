import demoFixture from "@/data/demo/limites.json";
import type { GenerationRequest, GenerationResponse, GraphSpec } from "@/lib/contract";
import { isDemo } from "@/lib/demo/mode";
import { usesGaze } from "@/lib/profiles";
import { syllabusForAI } from "@/lib/syllabus/store";
import { getData, updateVersion } from "./store";
import { keepExercises } from "@/lib/results/exercises";
import { versionLabel } from "./versions";

// Until Dev B has POST /api/generate, the front uses sample responses.
// To connect the real agent: NEXT_PUBLIC_USE_MOCK=false in .env.local.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

async function requestVersion(request: GenerationRequest): Promise<GenerationResponse> {
  if (isDemo()) return precomputed(request);
  if (USE_MOCK) return mock(request);
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new Error(json?.error ?? `La IA respondió con un error (${response.status}). Reintentá.`);
  }
  return response.json();
}

// When each precomputed version "arrives", in ms: one by one, like a real generation.
const DEMO_DELAY: Record<string, number> = { adhd: 2500, dysgraphia: 4000, motor: 5500 };

// The demo doesn't call the AI: the example worksheet answers with what the real agent generated for it
// (scripts/demo-fixture.ts). Anything else fails with the same message the API gives a demo session.
async function precomputed(request: GenerationRequest): Promise<GenerationResponse> {
  const key = request.profiles.join("+");
  const version = (demoFixture.versions as Record<string, GenerationResponse>)[key];
  await new Promise((resolve) => setTimeout(resolve, DEMO_DELAY[key] ?? 3000));
  if (request.original !== demoFixture.original || !version) {
    throw new Error("En la demo no se usa la IA en vivo. Ingresá con tu cuenta para probarla.");
  }
  return version;
}

// Does not invent adaptations: it only marks where each profile agent's output will go.
async function mock(request: GenerationRequest): Promise<GenerationResponse> {
  await new Promise((resolve) => setTimeout(resolve, 1000 + request.profiles.length * 900));
  const label = versionLabel(request.profiles, request.supports);
  const interests = request.interests ?? [];
  const { original, omitted } = keepExercises(request.original, request.keep);
  return {
    profiles: request.profiles,
    content: `[Versión de ejemplo: ${label}]\n\n${original}`,
    changes: [
      ...(omitted.length > 0
        ? [{ what: `Ejercicios ${omitted.join(", ")} sin incluir`, why: "Menos ítems: el docente eligió qué ejercicios quedan." }]
        : []),
      ...((request.supports ?? []).length > 0
        ? [{ what: "Apoyos de ejemplo", why: "Acá van los apoyos de razonamiento disminuido que habilitó el docente." }]
        : []),
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
    ...(usesGaze(request.profiles) && {
      questions: [
        {
          exercise: 1,
          stem: "[Pregunta de ejemplo] Acá va el ejercicio 1, para responder con la mirada.",
          options: [
            { id: "A", text: "Opción correcta" },
            { id: "B", text: "Error de signo" },
          ],
          answer: "A",
        },
        {
          exercise: 2,
          stem: "[Pregunta de ejemplo] Acá va el ejercicio 2.",
          options: [
            { id: "A", text: "Error de cálculo" },
            { id: "B", text: "Opción correcta" },
          ],
          answer: "B",
        },
        {
          exercise: 3,
          stem: "[Pregunta de ejemplo] ¿Cuál es la gráfica de $f(x)=x^2-2x$?",
          options: [
            { id: "A", text: "Gráfica A", graph: sampleParabola("x^2 - 2*x", 1, -1) },
            { id: "B", text: "Gráfica B", graph: sampleParabola("-(x^2 - 2*x)", 1, 1) },
          ],
          answer: "A",
        },
      ],
    }),
  };
}

// A parabola with its vertex marked, for the sample graph options.
function sampleParabola(expr: string, x: number, y: number): GraphSpec {
  return { functions: [{ expr }], points: [{ x, y, label: "Vértice" }], window: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 } };
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
      updateVersion(assessmentId, index, { status: "generating", error: undefined });
      try {
        const { content, changes, questions } = await requestVersion({
          type: assessment.type,
          topic: assessment.topic,
          original: assessment.original,
          profiles: version.profiles,
          interests: version.interests,
          supports: version.supports,
          keep: version.keep,
          syllabus,
        });
        updateVersion(assessmentId, index, { status: "ready", content, changes, questions, questionsStale: false, approved: false });
      } catch (e) {
        updateVersion(assessmentId, index, { status: "error", error: e instanceof Error ? e.message : undefined });
      } finally {
        inFlight.delete(key);
      }
    }),
  );
}
