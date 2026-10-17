import type { Assessment } from "@/lib/groups/types";

export type Exercise = {
  number: number;
  label: string;
  text: string;
};

// A line that starts an exercise: "1)", "2.", "3 -", "Ejercicio 4", "Ej. 5".
const START = /^\s*(?:(?:ejercicio|ej\.?)\s*)?(\d{1,2})\s*[).:\-–]?\s+(?=\S)/i;

// Splits the original into exercises by their numbering. Text before the first number (a heading)
// is dropped. Without numbering, the whole text is a single exercise.
export function splitExercises(original: string): Exercise[] {
  const exercises: Exercise[] = [];
  for (const line of original.split("\n")) {
    const match = line.match(START);
    if (match) {
      exercises.push({ number: Number(match[1]), label: `Ej. ${match[1]}`, text: line.slice(match[0].length).trim() });
    } else if (exercises.length > 0 && line.trim()) {
      exercises[exercises.length - 1].text += `\n${line.trim()}`;
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
