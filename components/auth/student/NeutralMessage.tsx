"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { IdeaIcon } from "./IdeaIcon";

type Props = {
  id?: string;
  children: ReactNode;
  /** A message that answers a submit takes the focus; one that appears while the student types does not. */
  takeFocus?: boolean;
};

/** Neutral and encouraging: grey ground, a light bulb, a concrete hint. Announced as an alert. */
export function NeutralMessage({ id, children, takeFocus = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (takeFocus) ref.current?.focus();
  }, [takeFocus]);
  return (
    <div
      id={id}
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="flex gap-3 rounded-xl bg-slate-100 p-4 text-lg text-slate-900 focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-indigo-950"
    >
      <IdeaIcon className="mt-1 size-6 shrink-0 text-indigo-800" />
      <div className="space-y-2">{children}</div>
    </div>
  );
}
