"use client";

import { useId, useState } from "react";
import { field, secondaryButton } from "@/components/ui/styles";
import { normalizeInterest } from "@/lib/groups/versions";

// Free-text interests as removable chips. The datalist suggests the group's existing interests
// so they get spelled the same way and versions can group them.
export function InterestsEditor({
  studentName,
  interests,
  suggestions,
  onChange,
}: {
  studentName: string;
  interests: string[];
  suggestions: string[];
  onChange: (interests: string[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");

  const add = () => {
    const interest = normalizeInterest(draft);
    if (interest && !interests.includes(interest)) onChange([...interests, interest]);
    setDraft("");
  };

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${id}-input`} className="block text-lg font-semibold">
          Gustos e intereses
        </label>
        <p id={`${id}-help`} className="text-base text-slate-700">
          Se usan para ambientar los ejercicios. A la IA le llegan los gustos, nunca el nombre.
        </p>
      </div>
      {interests.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`Gustos de ${studentName}`}>
          {interests.map((interest) => (
            <li
              key={interest}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border-2 border-indigo-700 bg-indigo-50 pl-4 text-base font-semibold text-indigo-900"
            >
              {interest}
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-full text-xl hover:bg-indigo-100"
                aria-label={`Quitar ${interest}`}
                onClick={() => onChange(interests.filter((i) => i !== interest))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        <input
          id={`${id}-input`}
          className={`${field} max-w-sm flex-1`}
          placeholder="Ej.: fútbol"
          list={`${id}-suggestions`}
          aria-describedby={`${id}-help`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <datalist id={`${id}-suggestions`}>
          {suggestions
            .filter((s) => !interests.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
        <button type="button" className={secondaryButton} onClick={add} disabled={!draft.trim()}>
          Agregar
        </button>
      </div>
    </div>
  );
}
