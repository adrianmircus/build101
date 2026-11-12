"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A message that is announced (role="alert") and takes the focus when it appears, so a keyboard or screen reader
// user lands on it. It carries an icon and text, never only color. To announce the same message a second time,
// the caller remounts it with a new `key`.

type Props = { tone: "error" | "neutral"; id?: string; children: ReactNode };

const TONES = {
  error: "bg-red-50 text-red-950",
  neutral: "bg-slate-100 text-slate-900",
} as const;

function Icon({ tone }: { tone: Props["tone"] }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 size-6 shrink-0">
      {tone === "error" ? (
        <>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 7.5v5.5M12 16.5h.01" />
        </>
      ) : (
        <>
          <path d="M9 18h6M10 21h4" />
          <path d="M12 3a6 6 0 0 0-3.5 10.9c.7.6 1 1.3 1 2.1h5c0-.8.3-1.5 1-2.1A6 6 0 0 0 12 3Z" />
        </>
      )}
    </svg>
  );
}

export function StatusMessage({ tone, id, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      id={id}
      role="alert"
      tabIndex={-1}
      className={`flex gap-3 rounded-xl p-4 text-lg outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-indigo-950 ${TONES[tone]}`}
    >
      <Icon tone={tone} />
      <div className="min-w-0 space-y-2 [overflow-wrap:break-word]">{children}</div>
    </div>
  );
}
