// Tiza.ai brand. The mark is a chalk "t" on the board with the amber dot of ".ai".
// Same drawing as app/icon.svg (the favicon): keep both in sync.
export function TizaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="14" fill="#1e1b4b" />
      <g stroke="#f8fafc" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M27 13V40Q27 49 36 49H38" />
        <path d="M17 25H39" />
      </g>
      <circle cx="48" cy="48" r="5" fill="#fcd34d" />
    </svg>
  );
}

// "dark" = on the board (indigo-950); "light" = on white or slate-50.
// The ".ai" amber changes shade so it stays legible on each background.
export function Logo({ tone = "light", className = "" }: { tone?: "light" | "dark"; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-bold tracking-tight ${className}`}>
      <TizaMark className="size-[1.6em] shrink-0" />
      <span className={tone === "dark" ? "text-white" : "text-slate-900"}>
        Tiza<span className={tone === "dark" ? "text-amber-300" : "text-amber-700"}>.ai</span>
      </span>
    </span>
  );
}
