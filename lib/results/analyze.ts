import type { ResultsAnalysisRequest, ResultsAnalysisResponse } from "@/lib/contract";
import { getData, saveAnalysis } from "@/lib/groups/store";
import type { Group } from "@/lib/groups/types";
import { errorLabel } from "./catalog";
import { exercisesOf } from "./exercises";
import { allMarks, assessmentsWithResults, errorCounts, exerciseStats, formatPercent, studentsWithVersion } from "./metrics";

// Same switch as lib/groups/generate.ts: NEXT_PUBLIC_USE_MOCK=false in .env.local uses the real agent.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

// Names never leave the browser: each student becomes "E1", "E2"… in the group's order.
function buildRequest(group: Group): { request: ResultsAnalysisRequest; refToId: Map<string, string> } {
  const refToId = new Map(group.students.map((s, i) => [`E${i + 1}`, s.id]));
  const idToRef = new Map([...refToId].map(([ref, id]) => [id, ref]));
  const assessments = assessmentsWithResults(getData(), group.id).map((a) => {
    const exercises = exercisesOf(a);
    return {
      type: a.type,
      topic: a.topic,
      exercises: exercises.map((e) => e.text),
      students: studentsWithVersion(a, group)
        .map((s) => ({
          ref: idToRef.get(s.id)!,
          grade: a.grades?.[s.id]?.score,
          marks: exercises.map((_, i) => {
            const r = a.exerciseResults?.[s.id]?.[i];
            return r ? { status: r.status, errors: r.errors.map(errorLabel) } : null;
          }),
        }))
        .filter((s) => s.grade !== undefined || s.marks.some(Boolean)),
    };
  });
  return { request: { assessments }, refToId };
}

// Built from the metrics only, so the demo works without an API key.
async function mock(group: Group): Promise<ResultsAnalysisResponse> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const assessments = assessmentsWithResults(getData(), group.id);
  const hardest = assessments
    .flatMap((a) => exerciseStats(a).map((e) => ({ ...e, topic: a.topic })))
    .filter((e) => e.accuracy !== null)
    .sort((a, b) => a.accuracy! - b.accuracy!)
    .slice(0, 2);
  const errors = errorCounts(allMarks(assessments)).slice(0, 2);
  const { refToId } = buildRequest(group);
  return {
    summary: `[Análisis de ejemplo] ${
      hardest[0] ? `El ejercicio que más costó fue el ${hardest[0].label} de «${hardest[0].topic}» (${formatPercent(hardest[0].accuracy!)} de acierto).` : ""
    } ${errors[0] ? `El error más repetido es «${errorLabel(errors[0].id)}» (${errors[0].count} veces).` : ""}`.trim(),
    difficulties: [
      ...hardest.map((e) => ({
        topic: `${e.label}: ${e.topic}`,
        evidence: `${e.counts.wrong} mal y ${e.counts.partial} parcial de ${e.marked} corregidos.`,
      })),
      ...errors.map((e) => ({ topic: errorLabel(e.id), evidence: `Aparece ${e.count} veces en las correcciones.` })),
    ],
    students: [...refToId]
      .filter(([, id]) => allMarks(assessments, id).length > 0)
      .map(([ref]) => ({ ref, summary: "Acá va el resumen de la IA para este estudiante." })),
  };
}

async function requestAnalysis(group: Group, request: ResultsAnalysisRequest): Promise<ResultsAnalysisResponse> {
  if (USE_MOCK) return mock(group);
  const response = await fetch("/api/results/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "No pudimos analizar los resultados. Reintentá.");
  return body;
}

// Asks the agent and saves the draft for the group, with each pseudonym mapped back to the student.
export async function analyzeGroup(group: Group) {
  const { request, refToId } = buildRequest(group);
  const result = await requestAnalysis(group, request);
  saveAnalysis(group.id, {
    summary: result.summary,
    difficulties: result.difficulties,
    students: result.students
      .filter((s) => refToId.has(s.ref))
      .map((s) => ({ studentId: refToId.get(s.ref)!, summary: s.summary })),
    createdAt: new Date().toISOString(),
  });
}
