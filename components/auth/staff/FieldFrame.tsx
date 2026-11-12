import type { ReactNode } from "react";

// Label, hint and error of a field. The ids are derived from the field id so the input can point at them with
// aria-describedby. The error has an icon: it is never only color.

export function describedBy(id: string, parts: { hint?: string; error?: string }): string | undefined {
  const ids = [parts.error ? `${id}-error` : "", parts.hint ? `${id}-hint` : ""].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

type Props = { id: string; label: string; hint?: string; error?: string; children: ReactNode };

export function FieldFrame({ id, label, hint, error, children }: Props) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-lg font-semibold">
        {label}
      </label>
      {error && (
        <p id={`${id}-error`} className="flex gap-2 text-base font-semibold text-red-900">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="mt-0.5 size-5 shrink-0">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M12 7.5v5.5M12 16.5h.01" />
          </svg>
          <span>{error}</span>
        </p>
      )}
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-base text-slate-700">
          {hint}
        </p>
      )}
    </div>
  );
}
