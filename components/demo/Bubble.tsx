"use client";

import { Fragment, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useStepFocus } from "./useStepFocus";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex='-1'])";

// "Tocá *Generar 3 versiones*." → the button's name in bold.
function Body({ text }: { text: string }) {
  return text.split(/\*(.+?)\*/).map((part, i) =>
    i % 2 === 1 ? (
      <em key={i} className="font-semibold">
        {part}
      </em>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

// The highlighted element if it can take focus, or the first thing inside it that can.
function firstFocusable(anchor: string): HTMLElement | null | undefined {
  const element = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
  return element?.matches(FOCUSABLE) ? element : element?.querySelector<HTMLElement>(FOCUSABLE);
}

// Non-modal dialog: the highlighted element has to stay usable. Focus comes to the title on each new bubble;
// on action steps, Tab from the bubble goes straight to the highlighted element.
export function Bubble({
  id,
  label,
  title,
  body,
  actions,
  anchor,
}: {
  id: string;
  label: string;
  title: string;
  body: string;
  actions: ReactNode;
  anchor?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useStepFocus(titleRef, id);

  const toAnchor = (e: KeyboardEvent) => {
    if (!anchor || e.key !== "Tab" || e.shiftKey || !ref.current) return;
    const own = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (document.activeElement !== titleRef.current && document.activeElement !== own.at(-1)) return;
    const target = firstFocusable(anchor);
    if (!target) return;
    e.preventDefault();
    target.focus();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={`tour-${id}-title`}
      aria-describedby={`tour-${id}-body`}
      onKeyDown={toAnchor}
      className="rounded-2xl bg-white p-5 text-slate-900 shadow-2xl shadow-black/40 ring-1 ring-slate-900/10 sm:p-6"
    >
      <p className="text-base font-semibold text-indigo-800">{label}</p>
      {/* Focused by code, not by the visitor: no ring (inline, the global :focus-visible rule wins over classes). */}
      <h2 id={`tour-${id}-title`} ref={titleRef} tabIndex={-1} className="mt-1 text-xl font-bold" style={{ outline: "none" }}>
        {title}
      </h2>
      <p id={`tour-${id}-body`} className="mt-2 text-lg leading-relaxed">
        <Body text={body} />
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">{actions}</div>
    </div>
  );
}
