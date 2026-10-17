"use client";

import { focusWithin } from "@/components/ui/styles";
import { sortSupports, supportLabel, SUPPORTS, type Support } from "@/lib/supports";

// "Razonamiento disminuido": the supports the teacher turns on for a student whose adaptation asks for them.
// Native checkboxes shaped like chips, like ProfileSelector. They lower the difficulty, so the version is marked.
export function SupportsEditor({
  studentName,
  supports,
  onChange,
}: {
  studentName: string;
  supports: Support[];
  onChange: (supports: Support[]) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="block text-lg font-semibold">Razonamiento disminuido</legend>
      <p className="text-base text-slate-700">
        Apoyos que bajan la dificultad. Si marcás alguno, {studentName} recibe una versión propia, marcada como
        «Dificultad modificada».
      </p>
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {SUPPORTS.map((support) => {
          const checked = supports.includes(support);
          return (
            <label
              key={support}
              className={`inline-flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-full border-2 px-3 text-base font-semibold transition-colors sm:px-4 ${focusWithin} ${
                checked
                  ? "border-indigo-700 bg-indigo-700 text-white"
                  : "border-slate-500 bg-white text-slate-900 hover:border-slate-800 hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() =>
                  onChange(checked ? supports.filter((s) => s !== support) : sortSupports([...supports, support]))
                }
              />
              <span aria-hidden="true">{checked ? "✓" : "+"}</span>
              {supportLabel(support)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
