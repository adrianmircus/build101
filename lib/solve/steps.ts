import type { Question } from "@/lib/contract";
import type { Submission, Version } from "@/lib/groups/types";
import { usesGaze, usesVoice } from "@/lib/profiles";
import { splitExercises } from "@/lib/results/exercises";

// One screen of the assessment the student solves. How they answer depends on the version's profiles:
// multiple choice with eye gaze, dictation, or typing.
export type Step =
  | { kind: "choice"; index: number; label: string; text: string; question: Question }
  | { kind: "voice" | "typed"; index: number; label: string; text: string };

// index is where the answer is saved: the question index for "choice" (Submission.choices),
// for the rest, the exercise's position in the original (Submission.answers), the same index the teacher corrects.
export function stepsOf(version: Version, original: string): Step[] {
  if (usesGaze(version.profiles) && version.questions && version.questions.length > 0) {
    return version.questions.map((question, index) => ({
      kind: "choice",
      index,
      label: `Ejercicio ${question.exercise}`,
      text: question.stem,
      question,
    }));
  }
  const kind = usesVoice(version.profiles) ? "voice" : "typed";
  // The index is the position of the same exercise in the original, which is what the teacher corrects
  // (exercisesOf). An original numbered 2 and 5 gives 0 and 1, not 1 and 4. An exercise the original doesn't
  // have joins the previous one: a slot of its own could collide with another's or fall outside what's corrected.
  const numbers = splitExercises(original).map((e) => e.number);
  const steps: Step[] = [];
  for (const e of splitExercises(version.content ?? "")) {
    const at = numbers.indexOf(e.number);
    const last = steps[steps.length - 1];
    if (at === -1 && last) {
      last.text += `\n\n${e.text}`;
      continue;
    }
    const used = new Set(steps.map((s) => s.index));
    const index = at !== -1 && !used.has(at) ? at : numbers.findIndex((_, i) => !used.has(i));
    if (index === -1) {
      if (last) last.text += `\n\n${e.text}`;
      continue;
    }
    steps.push({ kind, index, label: `Ejercicio ${e.number}`, text: e.text });
  }
  return steps;
}

export function isAnswered(step: Step, submission: Submission | undefined): boolean {
  if (step.kind === "choice") return Boolean(submission?.choices?.[step.index]);
  return Boolean(submission?.answers[step.index]?.text.trim());
}
