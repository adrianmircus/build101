import type { ReactNode } from "react";
import type { ExerciseStatus } from "@/lib/groups/types";
import { OUTCOMES, outcomeOf } from "@/lib/rewards/exerciseFeedback";

// How one exercise went, for the student: a face, a shape and a word, never color alone, and the same
// for every profile. live announces it to screen readers as it appears (instant feedback in practice or
// gaze); leave it off in a list of corrections so a screen reader doesn't read ten announcements at once.
export function ExerciseFeedback({
  status,
  exerciseNumber,
  live = false,
  action,
}: {
  status: ExerciseStatus;
  exerciseNumber?: number;
  live?: boolean;
  // Room for "Ver pista" or "Reintentar" once periodic practice has them.
  action?: ReactNode;
}) {
  const outcome = OUTCOMES[outcomeOf(status)];
  return (
    <div
      role={live ? "status" : undefined}
      className={`flex flex-wrap items-center gap-4 rounded-2xl border-2 px-4 py-3 transition-[scale,opacity] duration-200 ease-out starting:scale-95 starting:opacity-0 motion-reduce:transition-none ${outcome.box}`}
    >
      <Face shape={outcome.shape} className={`size-12 shrink-0 ${outcome.ink}`} />
      <p className="text-xl">
        {exerciseNumber !== undefined && <span className="block text-base">Ejercicio {exerciseNumber}</span>}
        <span className="font-bold">{outcome.label}</span>
      </p>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

// Decorative: the word next to it carries the meaning. The circle smiles; the square stays calm, never sad.
function Face({ shape, className }: { shape: "circle" | "square"; className: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" data-shape={shape} className={className}>
      {shape === "circle" ? (
        <circle cx="24" cy="24" r="21" fill="white" stroke="currentColor" strokeWidth="3" />
      ) : (
        <rect x="3" y="3" width="42" height="42" rx="10" fill="white" stroke="currentColor" strokeWidth="3" />
      )}
      <circle cx="17" cy="20" r="2.5" fill="currentColor" />
      <circle cx="31" cy="20" r="2.5" fill="currentColor" />
      <path
        d={shape === "circle" ? "M15 28 Q24 37 33 28" : "M16 30 Q24 33 32 30"}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
