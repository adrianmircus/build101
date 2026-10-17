import type { Assessment, Data, Version } from "./types";

export const GRADE_MIN = 1;
export const GRADE_MAX = 10;

// A whole number from 1 to 10, or null if the text isn't one.
export function parseScore(text: string): number | null {
  const score = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(score) && score >= GRADE_MIN && score <= GRADE_MAX ? score : null;
}

export function formatAverage(scores: number[]): string {
  const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return average.toLocaleString("es-UY", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// What a student can see: assessments of their group where their version is already approved. Newest first.
export function assignedTo(data: Data, studentId: string, groupId: string): Assessment[] {
  return data.assessments
    .filter((a) => a.groupId === groupId)
    .filter((a) => a.versions.some((v) => v.approved && v.studentIds.includes(studentId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// The approved version a student solves. undefined if theirs isn't approved yet.
export function versionOf(assessment: Assessment, studentId: string): Version | undefined {
  return assessment.versions.find((v) => v.approved && v.studentIds.includes(studentId));
}
