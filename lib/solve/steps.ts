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
// the exercise number − 1 for the rest (Submission.answers), the same index the teacher corrects.
export function stepsOf(version: Version): Step[] {
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
  return splitExercises(version.content ?? "").map((e) => ({
    kind,
    index: e.number - 1,
    label: `Ejercicio ${e.number}`,
    text: e.text,
  }));
}

export function isAnswered(step: Step, submission: Submission | undefined): boolean {
  if (step.kind === "choice") return Boolean(submission?.choices?.[step.index]);
  return Boolean(submission?.answers[step.index]?.text.trim());
}
