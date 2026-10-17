import type { Assessment } from "@/lib/groups/types";

export type Exercise = {
  number: number;
  label: string;
  text: string;
};

// A line that starts an exercise: "1)", "2.", "3 -", "Ejercicio 4", "Ej. 5", also as a markdown heading
// or in bold ("### Ejercicio 2", "**Ejercicio 3.**"), which is how the adapted versions come.
const MARKDOWN = /^\s*(?:#{1,6}\s+|>\s*|\*\*|__)*/;
const START = /^(?:(ejercicio|ej\.?)\s*)?(\d{1,2})\s*[).:\-–]?(?:\*\*|__)?(?:\s+(?=\S)|\s*$)/i;

// Splits a text into exercises by their numbering. Text before the first number (a heading) is dropped.
// If some line says "Ejercicio N", only those start exercises, so numbered sub-items ("1.", "2.") stay inside.
// A number that doesn't go up continues the current exercise: numbers never repeat.
// Without numbering, the whole text is a single exercise.
export function splitExercises(original: string): Exercise[] {
  const lines = original.split("\n").map((line) => {
    const clean = line.replace(MARKDOWN, "");
    return { line, clean, match: clean.match(START) };
  });
  const named = lines.some((l) => l.match?.[1]);
  const exercises: Exercise[] = [];
  for (const { line, clean, match } of lines) {
    const number = match ? Number(match[2]) : 0;
    const last = exercises[exercises.length - 1];
    if (match && (!named || match[1]) && (!last || number > last.number)) {
      exercises.push({ number, label: `Ej. ${number}`, text: clean.slice(match[0].length).trim() });
    } else if (last && line.trim()) {
      last.text += `\n${line.trim()}`;
    }
  }
  return exercises.length > 0 ? exercises : [{ number: 1, label: "Ej. 1", text: original.trim() }];
}

// The exercises the teacher corrects: the detected ones, adjusted to the count the teacher set.
export function exercisesOf(assessment: Assessment): Exercise[] {
  const detected = splitExercises(assessment.original);
  const count = assessment.exerciseCount ?? detected.length;
  return Array.from({ length: count }, (_, i) => detected[i] ?? { number: i + 1, label: `Ej. ${i + 1}`, text: "" });
}

export function shorten(text: string, max = 70): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
