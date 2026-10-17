import type { Assessment, Data, ExerciseResult, ExerciseStatus, Group } from "@/lib/groups/types";
import { STATUS_BY_ID } from "./catalog";
import { exercisesOf, type Exercise } from "./exercises";

// Pure functions over the stored data: the Results tab and the AI analysis read from here.

export function studentsWithVersion(assessment: Assessment, group: Group) {
  return group.students.filter((s) => assessment.versions.some((v) => v.studentIds.includes(s.id)));
}

function marks(assessment: Assessment, studentId: string): ExerciseResult[] {
  const count = exercisesOf(assessment).length;
  return (assessment.exerciseResults?.[studentId] ?? [])
    .slice(0, count)
    .filter((r): r is ExerciseResult => r !== null);
}

export function hasResults(assessment: Assessment): boolean {
  return (
    Object.keys(assessment.grades ?? {}).length > 0 ||
    Object.keys(assessment.exerciseResults ?? {}).some((id) => marks(assessment, id).length > 0)
  );
}

// Oldest first, so the columns of the table read like a timeline.
export function assessmentsWithResults(data: Data, groupId: string): Assessment[] {
  return data.assessments
    .filter((a) => a.groupId === groupId && hasResults(a))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Share of points over the marked exercises (bien = 1, parcial = ½). null if nothing is marked.
export function accuracy(results: ExerciseResult[]): number | null {
  if (results.length === 0) return null;
  return results.reduce((sum, r) => sum + STATUS_BY_ID[r.status].score, 0) / results.length;
}

export function studentAccuracy(assessment: Assessment, studentId: string): number | null {
  return accuracy(marks(assessment, studentId));
}

export function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function scoresOf(assessments: Assessment[], studentId?: string): number[] {
  return assessments.flatMap((a) =>
    Object.entries(a.grades ?? {})
      .filter(([id]) => studentId === undefined || id === studentId)
      .map(([, g]) => g.score),
  );
}

export function allMarks(assessments: Assessment[], studentId?: string): ExerciseResult[] {
  return assessments.flatMap((a) =>
    Object.keys(a.exerciseResults ?? {})
      .filter((id) => studentId === undefined || id === studentId)
      .flatMap((id) => marks(a, id)),
  );
}

export type ExerciseStats = Exercise & {
  counts: Record<ExerciseStatus, number>;
  marked: number;
  accuracy: number | null;
};

export function exerciseStats(assessment: Assessment): ExerciseStats[] {
  return exercisesOf(assessment).map((exercise, i) => {
    const counts: Record<ExerciseStatus, number> = { correct: 0, partial: 0, wrong: 0, blank: 0 };
    const results: ExerciseResult[] = [];
    for (const row of Object.values(assessment.exerciseResults ?? {})) {
      const r = row[i];
      if (r) {
        counts[r.status]++;
        results.push(r);
      }
    }
    return { ...exercise, counts, marked: results.length, accuracy: accuracy(results) };
  });
}

// Most frequent error types, highest first. Ties keep the catalog order.
export function errorCounts(results: ExerciseResult[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of results) for (const e of r.errors) counts.set(e, (counts.get(e) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
}

export function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString("es-UY", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}
