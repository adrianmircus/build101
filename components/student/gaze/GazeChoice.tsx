"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MathText } from "@/components/ui/MathText";
import type { OptionId, Question } from "@/lib/contract";
import { targetOf, zoneOf, type Zone } from "./calibration";
import { useGazeZone } from "./GazeSession";
import { useDwell } from "./useDwell";

// Multiple choice answered with eye gaze. Same props as ChoiceAnswer (components/solve) so they swap in one line.
// Looking at an option until the ring fills asks for confirmation; looking at "Sí" saves it. Clicking also works,
// for whoever is helping the student. The answer key (question.answer) is never read here.
export function GazeChoice({
  question,
  value,
  onChoose,
  disabled = false,
}: {
  question: Question;
  value: OptionId | null;
  onChoose: (id: OptionId) => void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<OptionId | null>(null);

  if (disabled) {
    const chosen = question.options.find((o) => o.id === value);
    return (
      <p className="rounded-xl border-2 border-slate-300 bg-slate-50 px-5 py-4 text-xl">
        {chosen ? (
          <>
            Elegiste <span className="font-bold">{chosen.id})</span> <MathText text={chosen.text} inline />
          </>
        ) : (
          "No elegiste ninguna opción."
        )}
      </p>
    );
  }

  const option = question.options.find((o) => o.id === pending);
  if (option) {
    return (
      <GazeYesNo
        prompt={
          <>
            ¿Confirmás la opción <span className="font-bold">{option.id})</span> <MathText text={option.text} inline />?
          </>
        }
        onYes={() => {
          onChoose(option.id);
          setPending(null);
        }}
        onNo={() => setPending(null)}
      />
    );
  }

  return (
    <GazeTargets
      label="Opciones"
      items={question.options.map((o) => ({
        key: o.id,
        spoken: `opción ${o.id}: ${o.text}`,
        content: (
          <>
            <span className="text-3xl font-bold">{o.id})</span>
            <MathText text={o.text} inline className="text-2xl" />
            {o.id === value && <span className="text-lg font-semibold">✓ Tu respuesta</span>}
          </>
        ),
        selected: o.id === value,
      }))}
      onSelect={(i) => setPending(question.options[i].id)}
    />
  );
}

// A yes/no question answered with eye gaze: "Sí" on the left half, "No" on the right. For confirming an option
// and for things like submitting the assessment.
export function GazeYesNo({
  prompt,
  yes = "Sí",
  no = "No",
  onYes,
  onNo,
}: {
  prompt: ReactNode;
  yes?: string;
  no?: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div>
      <p className="mb-4 text-2xl font-semibold">{prompt}</p>
      <GazeTargets
        label="Confirmación"
        items={[
          { key: "yes", spoken: yes, content: <span className="text-4xl font-bold">{yes}</span>, tone: "yes" },
          { key: "no", spoken: no, content: <span className="text-4xl font-bold">{no}</span>, tone: "no" },
        ]}
        onSelect={(i) => (i === 0 ? onYes() : onNo())}
      />
    </div>
  );
}

type Target = { key: string; spoken: string; content: ReactNode; selected?: boolean; tone?: "yes" | "no" };

const TONE = {
  default: "border-slate-300 bg-white",
  yes: "border-emerald-700 bg-emerald-50 text-emerald-950",
  no: "border-slate-500 bg-slate-50",
};

// Big targets in the screen quadrants (or halves, with 2). The one being looked at is highlighted and fills
// a ring; when it fills, it's selected.
function GazeTargets({ label, items, onSelect }: { label: string; items: Target[]; onSelect: (i: number) => void }) {
  const session = useGazeZone();
  const camera = session?.mode === "camera";
  const [pointer, setPointer] = useState<Zone | null>(null);
  const zone = camera ? session.zone : pointer;
  const n = items.length;
  const { target, progress } = useDwell(targetOf(zone, n), onSelect);

  // Practice mode: holding 1–4 counts as looking at that target.
  useEffect(() => {
    if (camera) return;
    const down = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < n) setPointer(zoneOf(i, n));
    };
    const up = () => setPointer(null);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [camera, n]);

  const looked = target !== null ? items[target] : null;
  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {looked ? `Mirando: ${looked.spoken}` : ""}
      </p>
      <ul aria-label={label} className={`grid min-h-[60vh] grid-cols-2 gap-4 ${n > 2 ? "grid-rows-2" : ""}`}>
        {items.map((item, i) => {
          const active = target === i;
          return (
            <li key={item.key} className="flex">
              <button
                type="button"
                onClick={() => onSelect(i)}
                onPointerEnter={() => !camera && setPointer(zoneOf(i, n))}
                onPointerLeave={() => !camera && setPointer(null)}
                className={`relative flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-4 p-6 text-center transition-colors ${
                  active
                    ? "border-indigo-700 bg-indigo-50 ring-4 ring-indigo-700"
                    : item.selected
                      ? "border-emerald-700 bg-emerald-50"
                      : TONE[item.tone ?? "default"]
                }`}
              >
                {item.content}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-4 right-4 grid size-14 place-items-center rounded-full"
                    style={{ background: `conic-gradient(var(--color-indigo-700) ${progress * 360}deg, var(--color-slate-200) 0)` }}
                  >
                    <span className="size-9 rounded-full bg-white" />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
