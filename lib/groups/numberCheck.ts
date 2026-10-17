import { usesGaze, usesVoice } from "@/lib/profiles";
import { splitExercises } from "@/lib/results/exercises";
import type { Version } from "./types";

// A check without AI before approving: every number of each original exercise has to still be in the same exercise
// of the adapted version. It catches a changed datum, not a wrong idea: the teacher still reviews the version.
export type NumberIssue = { exercise: number; missing: string[]; added: string[]; absent: boolean };
export type NumberCheck = { applies: false } | { applies: true; checked: number; issues: NumberIssue[] };

// The numbers written in a text, LaTeX included ("\frac{3}{4}" gives 3 and 4, "2,5" and "2.5" are the same).
function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")));
}

export function checkNumbers(original: string, version: Version): NumberCheck {
  // Multiple choice (eye gaze) and dictation rewrite the exercises on purpose; "números más simples" changes the data.
  const skip =
    !version.content ||
    usesGaze(version.profiles) ||
    usesVoice(version.profiles) ||
    (version.supports ?? []).includes("numeros_simples");
  if (skip) return { applies: false };

  const adapted = new Map(splitExercises(version.content ?? "").map((e) => [e.number, e.text]));
  const exercises = splitExercises(original).filter((e) => !version.keep || version.keep.includes(e.number));
  // Supports add guiding questions and worked examples with other numbers: then only missing numbers count.
  const strict = (version.supports ?? []).length === 0;
  const issues: NumberIssue[] = [];
  for (const e of exercises) {
    const text = adapted.get(e.number);
    if (text === undefined) {
      issues.push({ exercise: e.number, missing: [], added: [], absent: true });
      continue;
    }
    const before = numbersIn(e.text);
    const after = numbersIn(text);
    const missing = [...before].filter((n) => !after.has(n));
    const added = strict ? [...after].filter((n) => !before.has(n)) : [];
    if (missing.length > 0 || added.length > 0) issues.push({ exercise: e.number, missing, added, absent: false });
  }
  return { applies: true, checked: exercises.length, issues };
}

export function issueText(issue: NumberIssue): string {
  if (issue.absent) return `Ejercicio ${issue.exercise}: no aparece en la versión adaptada.`;
  const parts = [
    issue.missing.length > 0 && `falta ${issue.missing.join(", ")}`,
    issue.added.length > 0 && `aparece ${issue.added.join(", ")}`,
  ].filter(Boolean);
  return `Ejercicio ${issue.exercise}: ${parts.join("; ")}.`;
}
