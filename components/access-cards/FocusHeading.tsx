"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** A heading that takes the focus when it appears, so a keyboard or screen reader user lands on the result of what they did. */
export function FocusHeading({ id, takeFocus = true, children }: { id?: string; takeFocus?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (takeFocus) ref.current?.focus();
  }, [takeFocus]);
  return (
    <h2 id={id} ref={ref} tabIndex={-1} className="text-xl font-bold outline-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-indigo-950">
      {children}
    </h2>
  );
}
