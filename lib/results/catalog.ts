import type { ExerciseStatus } from "@/lib/groups/types";

// How an exercise went. Status colors always come with a symbol and a word, never color alone.
export const STATUSES: { id: ExerciseStatus; label: string; symbol: string; score: number }[] = [
  { id: "correct", label: "Bien", symbol: "✓", score: 1 },
  { id: "partial", label: "Parcial", symbol: "½", score: 0.5 },
  { id: "wrong", label: "Mal", symbol: "✗", score: 0 },
  { id: "blank", label: "Sin hacer", symbol: "—", score: 0 },
];

export const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s])) as Record<
  ExerciseStatus,
  (typeof STATUSES)[number]
>;

// Fills for marks (bars, chips) and the matching text color for labels next to them.
export const STATUS_FILL: Record<ExerciseStatus, string> = {
  correct: "bg-emerald-600",
  partial: "bg-amber-400",
  wrong: "bg-red-600",
  blank: "bg-slate-300",
};

export const STATUS_CHIP: Record<ExerciseStatus, string> = {
  correct: "border-emerald-700 bg-emerald-50 text-emerald-900",
  partial: "border-amber-600 bg-amber-50 text-amber-950",
  wrong: "border-red-700 bg-red-50 text-red-900",
  blank: "border-slate-500 bg-slate-100 text-slate-800",
};

// Kinds of mistakes the teacher can tag. It's a classification for the teacher's own metrics, not
// pedagogy: change the list here and every screen follows.
export const ERROR_TAGS: { id: string; label: string }[] = [
  { id: "calculation", label: "Cálculo u operatoria" },
  { id: "interpretation", label: "Interpretación del enunciado" },
  { id: "concept", label: "Concepto" },
  { id: "incomplete", label: "Procedimiento incompleto" },
  { id: "notation", label: "Notación" },
];

export function errorLabel(id: string): string {
  return ERROR_TAGS.find((t) => t.id === id)?.label ?? id;
}

// Only partial and wrong answers carry an error type.
export function canHaveErrors(status: ExerciseStatus): boolean {
  return status === "partial" || status === "wrong";
}
