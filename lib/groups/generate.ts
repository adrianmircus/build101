import demoFixture from "@/data/demo/limites.json";
import type { GenerationRequest, GenerationResponse, GraphSpec } from "@/lib/contract";
import { isDemo } from "@/lib/demo/mode";
import { usesGaze } from "@/lib/profiles";
import { syllabusForAI } from "@/lib/syllabus/store";
import { pendingRetry } from "./history";
import { getData, updateVersion } from "./store";
import { keepExercises } from "@/lib/results/exercises";
import { versionLabel } from "./versions";

// Until Dev B has POST /api/generate, the front uses sample responses.
// To connect the real agent: NEXT_PUBLIC_USE_MOCK=false in .env.local.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

// A bit more than the route's maxDuration (app/api/generate/route.ts): by then the server already gave up.
const REQUEST_TIMEOUT_MS = 310_000;

async function requestVersion(request: GenerationRequest): Promise<GenerationResponse> {
  if (isDemo()) return precomputed(request);
  if (USE_MOCK) return mock(request);
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Error("La IA tardó demasiado en responder. Reintentá.");
    throw e;
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error ?? `La IA respondió con un error (${response.status}). Reintentá.`);
  // The route answers 200 at once and sends the result at the end (app/api/generate/route.ts): errors come in the
  // body, and a body cut off halfway means the server ran out of time.
  if (!json) throw new Error("La IA tardó demasiado en responder. Reintentá.");
  if (json.error) throw new Error(json.error);
  return json;
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

// At most this many versions generating at once, across all the teacher's assessments: a group usually has about 4
// versions, and this only caps the big ones. A lower cap made the teacher wait twice as long for little saving.
const MAX_IN_FLIGHT = 4;
// The first version of an assessment goes alone for a few seconds: the next ones then read from the cache the prompt
// it wrote (system, syllabus and original are the same in every version). With 4 s they did in a real run.
const HEAD_START_MS = 4000;

let running = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (running < MAX_IN_FLIGHT) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

// The slot goes straight to the next in line, so nobody arriving in between can take it.
function release() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

// Generates every pending or failed version, a few at a time. Each one is saved as soon as it arrives,
// so the screen shows them one by one. The demo and the mock answer without the AI: they don't wait their turn.
export async function generatePending(assessmentId: string) {
  const assessment = getData().assessments.find((a) => a.id === assessmentId);
  if (!assessment) return;
  const syllabus = syllabusForAI();
  const live = !isDemo() && !USE_MOCK;
  let first = true;
  await Promise.all(
    assessment.versions.map(async (version, index) => {
      if (version.status !== "pending" && version.status !== "error") return;
      const key = `${assessmentId}:${index}`;
      if (inFlight.has(key)) return;
      inFlight.add(key);
      updateVersion(assessmentId, index, { status: "generating", error: undefined });
      const delay = live && !first ? HEAD_START_MS : 0;
      first = false;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (live) await acquire();
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
          retry: pendingRetry(version),
        });
        updateVersion(
          assessmentId,
          index,
          { status: "ready", content, changes, questions, questionsStale: false, approved: false },
          { type: "generated", at: new Date().toISOString(), content, changes, ...(questions ? { questions } : {}) },
        );
      } catch (e) {
        updateVersion(assessmentId, index, { status: "error", error: e instanceof Error ? e.message : undefined });
      } finally {
        if (live) release();
        inFlight.delete(key);
      }
    }),
  );
}
