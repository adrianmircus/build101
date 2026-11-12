"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = { title: string; children?: ReactNode; focus?: boolean };

/** The letter: what happened, in one sentence. With `focus`, the title takes the focus when it appears (result screens). */
export function InvitationLetter({ title, children, focus }: Props) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <div className="space-y-4">
      <h1 ref={ref} tabIndex={focus ? -1 : undefined} className="text-3xl font-bold outline-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-indigo-950 sm:text-4xl">
        {title}
      </h1>
      {children && <div className="max-w-xl space-y-3 text-lg text-slate-700 [overflow-wrap:break-word] [&_strong]:text-slate-900">{children}</div>}
    </div>
  );
}
