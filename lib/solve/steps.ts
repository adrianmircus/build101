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
  // (exercisesOf). An original numbered 2 and 5 gives 0 and 1, not 1 and 4.
  const numbers = splitExercises(original).map((e) => e.number);
  return splitExercises(version.content ?? "").map((e, i) => ({
    kind,
    index: numbers.includes(e.number) ? numbers.indexOf(e.number) : i,
    label: `Ejercicio ${e.number}`,
    text: e.text,
  }));
}

export function isAnswered(step: Step, submission: Submission | undefined): boolean {
  if (step.kind === "choice") return Boolean(submission?.choices?.[step.index]);
  return Boolean(submission?.answers[step.index]?.text.trim());
}
