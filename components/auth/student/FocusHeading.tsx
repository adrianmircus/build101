"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** The title of a view the student arrived at by a tap: it takes the focus, so keyboard and screen reader start from it. */
export function FocusHeading({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h1 id={id} ref={ref} tabIndex={-1} className="text-3xl font-bold focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-indigo-950">
      {children}
    </h1>
  );
}
