"use client";

import { useEffect, useState } from "react";

// Loading screen for every wait on the AI, in the adapter's visual language (components/adapter/AdapterProgress.tsx):
// one row per stage, ✓ when done and "…" while working.
// Our routes answer all at once, so the stages are estimated: they describe what the AI really does, in order, and
// move on with the expected time. The last one stays "in progress" until the answer arrives, and the bar stops at 90 %.
// When there's real progress (one row per version), it goes in `rows` and the bar follows it.

export type ProgressRow = { label: string; status: string; done: boolean; failed?: boolean };

// Which stage the wait is at, by elapsed time. It starts when mounted, so each wait starts from zero.
function useElapsed(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - start) / 1000), 500);
    return () => clearInterval(timer);
  }, []);
  return elapsed;
}

export function AiProgress({
  title,
  steps = [],
  seconds,
  rows,
  compact = false,
}: {
  title: string;
  steps?: string[];
  seconds: number;
  rows?: ProgressRow[];
  compact?: boolean;
}) {
  const elapsed = useElapsed();
  // Each stage gets an equal share of the expected time; the last one waits for the answer.
  const step = Math.max(0, Math.min(steps.length - 1, Math.floor((elapsed / seconds) * steps.length)));
  const estimated = Math.min(0.9, 0.9 * (1 - Math.exp((-2.3 * elapsed) / seconds)));
  const doneRows = rows?.filter((r) => r.done).length ?? 0;
  const progress = rows && rows.length > 0 ? doneRows / rows.length : estimated;
  const percent = Math.round(progress * 100);

  const stageList = (
    <ol className={compact ? "mt-2 space-y-1 text-base" : "mt-4 space-y-3 text-lg"}>
      {steps.map((label, i) => (
        <Row
          key={label}
          label={label}
          state={i < step ? "done" : i === step ? "active" : "waiting"}
          compact={compact}
        />
      ))}
    </ol>
  );

  return (
    <section
      aria-label={title}
      className={compact ? "rounded-xl border-2 border-indigo-200 bg-indigo-50 p-3" : "rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-4 sm:p-6"}
    >
      <p className={compact ? "text-base font-bold text-indigo-950" : "text-xl font-bold text-indigo-950"}>{title}</p>
      {/* Only the stage change is announced, not every second. */}
      <p role="status" className="sr-only">
        {rows && rows.length > 0 ? `${doneRows} de ${rows.length} listas` : steps[step]}
      </p>

      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={rows && rows.length > 0 ? `${doneRows} de ${rows.length} listas` : `Paso ${step + 1} de ${steps.length}`}
        className={`${compact ? "mt-2 h-2" : "mt-3 h-3"} overflow-hidden rounded-full bg-indigo-100`}
      >
        <div className="h-full rounded-full bg-indigo-700 transition-[width] duration-500 ease-out" style={{ width: `${Math.max(4, percent)}%` }} />
      </div>

      {rows && rows.length > 0 && (
        <ol className="mt-4 space-y-2 text-lg">
          {rows.map((r) => (
            <li key={r.label} className="flex flex-wrap items-center gap-x-3">
              <Mark state={r.done ? "done" : r.failed ? "failed" : r.status === "En espera" ? "waiting" : "active"} />
              <span className="font-semibold">{r.label}:</span>
              <span className={r.failed ? "text-red-800" : "text-slate-800"}>{r.status}</span>
            </li>
          ))}
        </ol>
      )}

      {steps.length > 0 && stageList}

      <p className={compact ? "mt-2 text-sm text-slate-700" : "mt-4 text-base text-slate-700"}>
        Lleva {Math.floor(elapsed)} s · suele tardar alrededor de {seconds} s
      </p>
    </section>
  );
}

type State = "done" | "active" | "waiting" | "failed";

function Mark({ state, compact = false }: { state: State; compact?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${compact ? "size-6 text-sm" : "size-7 text-base"} ${
        state === "done"
          ? "bg-emerald-700 text-white"
          : state === "failed"
            ? "bg-red-700 text-white"
            : state === "active"
              ? "border-2 border-indigo-700 bg-white text-indigo-800 motion-safe:animate-pulse"
              : "border-2 border-slate-300 bg-white text-slate-400"
      }`}
    >
      {state === "done" ? "✓" : state === "failed" ? "!" : "…"}
    </span>
  );
}

function Row({ label, state, compact }: { label: string; state: State; compact: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <Mark state={state} compact={compact} />
      <span className={state === "waiting" ? "text-slate-500" : state === "active" ? "font-semibold text-indigo-950" : "text-slate-800"}>
        {label}
        {state === "active" && "…"}
      </span>
    </li>
  );
}
