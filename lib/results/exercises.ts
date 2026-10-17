import type { Assessment } from "@/lib/groups/types";

export type Exercise = {
  number: number;
  label: string;
  text: string;
};

// A line that starts an exercise: "1)", "2.", "3 -", "Ejercicio 4", "Ej. 5", also with the Markdown the agent
// writes: "**1)**", "**Ejercicio 2.**", "### 3)". A bare number needs its separator, so "2.5" or "2 + 3" don't count.
const START =
  /^\s*(?:#{1,6}\s+)?(\*\*)?\s*(?:(?:ejercicio|ej\.?)\s*(\d{1,2})\s*[).:\-–]?|(\d{1,2})\s*[).:\-–])\s*?(\*\*\s*|\s+|$)/i;
// A Markdown title ("# Ecuaciones racionales") and a separator line ("---").
const HEADING = /^\s*#{1,6}\s/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

// Splits the original into exercises by their numbering. Text before the first number (a heading)
// is dropped. Numbers only go up, so a "2 - x = 1" line inside exercise 2 doesn't start another one.
// Without numbering, the whole text minus a leading title is a single exercise.
export function splitExercises(original: string): Exercise[] {
  const exercises: Exercise[] = [];
  for (const line of original.split("\n")) {
    if (RULE.test(line)) continue;
    const match = line.match(START);
    const number = match ? Number(match[2] ?? match[3]) : 0;
    const last = exercises.at(-1);
    if (match && (!last || number > last.number)) {
      let text = line.slice(match[0].length).trim();
      // "**1) Resolvé** en…": the bold goes past the number, so it stays open.
      if (match[1] && !match[4].startsWith("**")) text = `**${text}`;
      exercises.push({ number, label: `Ej. ${number}`, text });
    } else if (last && line.trim()) {
      last.text = last.text ? `${last.text}\n${line.trim()}` : line.trim();
    }
  }
  if (exercises.length > 0) return exercises;
  const lines = original.split("\n");
  while (lines.length > 0 && (!lines[0].trim() || HEADING.test(lines[0]))) lines.shift();
  return [{ number: 1, label: "Ej. 1", text: lines.join("\n").trim() }];
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
