"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FunctionGraph } from "@/components/ui/FunctionGraph";
import { MathText } from "@/components/ui/MathText";
import type { OptionId, Question } from "@/lib/contract";
import { describeGraph } from "@/lib/graphText";
import { targetOf, zoneOf, type Zone } from "./calibration";
import { useGazeZone } from "./GazeSession";
import { useDwell } from "./useDwell";

// A two-option choice answered with eye gaze: one option per half of the screen.
// Looking at an option until the ring fills asks for confirmation; looking at "Sí" saves it. Clicking also works,
// for whoever is helping the student. The answer key (question.answer) is only read to keep it in old versions.
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
  // Versions generated before the two-option rule may have more: two fit the two halves, and the right one must be
  // among them. Without saying which: they keep their order.
  const wrong = question.options.find((o) => o.id !== question.answer);
  const options =
    question.options.length <= 2
      ? question.options
      : question.options.filter((o) => o.id === question.answer || o === wrong);

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

  const option = options.find((o) => o.id === pending);
  if (option) {
    return (
      <GazeYesNo
        prompt={
          <>
            ¿Confirmás la opción <span className="font-bold">{option.id})</span> <MathText text={option.text} inline />?
            {option.graph && (
              <span className="mt-3 block w-[min(100%,40vh)]">
                <FunctionGraph spec={option.graph} />
              </span>
            )}
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

  const target = (o: Question["options"][number]): GazeTarget => ({
    key: o.id,
    spoken: `opción ${o.id}: ${o.text}${o.graph ? `. ${describeGraph(o.graph)}` : ""}`,
    content: (
      <>
        <span className="text-3xl font-bold">{o.id})</span>
        <MathText text={o.text} inline className="text-2xl" />
        {o.graph && (
          // Sized by the screen height so the graph fits in its half.
          <span className="block w-[min(100%,40vh)]">
            <FunctionGraph spec={o.graph} />
          </span>
        )}
        {o.id === value && <span className="text-lg font-semibold">✓ Tu respuesta</span>}
      </>
    ),
    selected: o.id === value,
  });

  return (
    <GazeTargets
      label="Opciones"
      items={[target(options[0]), target(options[1])]}
      onSelect={(i) => setPending(options[i].id)}
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

export type GazeTarget = { key: string; spoken: string; content: ReactNode; selected?: boolean; tone?: "yes" | "no" };

const TONE = {
  default: "border-slate-300 bg-white",
  yes: "border-emerald-700 bg-emerald-50 text-emerald-950",
  no: "border-slate-500 bg-slate-50",
};

const KEY_ZONE: Record<string, Zone> = { ArrowLeft: "left", "1": "left", ArrowRight: "right", "2": "right" };

// Every choice in the gaze flow: two big targets, the left and right halves of the screen. The one being looked
// at is highlighted and fills a ring; when it fills, it's selected.
export function GazeTargets({
  label,
  items,
  onSelect,
}: {
  label: string;
  items: [GazeTarget, GazeTarget];
  onSelect: (i: number) => void;
}) {
  const session = useGazeZone();
  const camera = session?.mode === "camera";
  const [pointer, setPointer] = useState<Zone | null>(null);
  const zone = camera ? session.zone : pointer;
  const { target, progress } = useDwell(targetOf(zone), onSelect);
  const list = useRef<HTMLUListElement>(null);

  // Whoever answers with eye gaze can't scroll: when the two targets show up, the page moves so they fit on screen.
  useEffect(() => {
    list.current?.scrollIntoView({ block: "nearest" });
  }, []);

  // Practice mode: holding ← or → (or 1 or 2) counts as looking at that half.
  useEffect(() => {
    if (camera) return;
    const down = (e: KeyboardEvent) => {
      const next = KEY_ZONE[e.key];
      if (next) {
        e.preventDefault();
        setPointer(next);
      }
    };
    const up = () => setPointer(null);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [camera]);

  const looked = target !== null ? items[target] : null;
  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {looked ? `Mirando: ${looked.spoken}` : ""}
      </p>
      <ul ref={list} aria-label={label} className="grid min-h-[60vh] grid-cols-2 gap-4">
        {items.map((item, i) => {
          const active = target === i;
          return (
            <li key={item.key} className="flex">
              <button
                type="button"
                onClick={() => onSelect(i)}
                onPointerEnter={() => !camera && setPointer(zoneOf(i))}
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
