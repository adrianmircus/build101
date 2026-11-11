import type { ExerciseStatus } from "@/lib/groups/types";

// What the student sees about one exercise. Only two states: a mistake never gets a sad face or the
// word "Mal", just a neutral, encouraging "not yet". Nothing here takes a profile, so it looks the
// same for every student and can't reveal theirs.
export type ExerciseOutcome = "correct" | "notYet";

export function outcomeOf(status: ExerciseStatus): ExerciseOutcome {
  return status === "correct" ? "correct" : "notYet";
}

// Provisional wording and look, from docs/ROADMAP.md (layer 5). Specialists still have to validate the
// reinforcement style (epic C); change it here and the component follows. Each outcome has its own
// shape and word, so color is never the only cue.
export const OUTCOMES: Record<
  ExerciseOutcome,
  { label: string; shape: "circle" | "square"; box: string; ink: string }
> = {
  correct: {
    label: "¡Bien!",
    shape: "circle",
    box: "border-emerald-700 bg-emerald-50 text-emerald-900",
    ink: "text-emerald-700",
  },
  notYet: {
    label: "Casi, mirá este paso",
    shape: "square",
    box: "border-amber-600 bg-amber-50 text-amber-950",
    ink: "text-amber-700",
  },
};
