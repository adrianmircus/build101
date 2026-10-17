"use client";

import { field } from "@/components/ui/styles";

// Typing the answer. It saves on every change: there is no "save" button.
export function TypedAnswer({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xl font-semibold">
        Tu respuesta
      </label>
      <textarea
        id={id}
        className={`${field} min-h-48 text-xl leading-relaxed`}
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-help`} className="mt-2 text-base text-slate-700">
        Escribí el desarrollo y el resultado. Se guarda solo.
      </p>
    </div>
  );
}
