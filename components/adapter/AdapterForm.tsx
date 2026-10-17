"use client";

import { useState } from "react";
import { card, field, focusWithin, primaryButton, secondaryButton } from "@/components/ui/styles";
import { ADJUSTMENT_LABELS, ADJUSTMENTS, type Adjustment } from "@/lib/adapter/adapt-schemas";
import { ACCEPTED, MAX_FILES, uploadIssue } from "@/lib/adapter/upload";

export type AdaptInput = { files: File[]; text?: string; ajustes: Adjustment[]; keepItems: string[] };

const EXAMPLE = `Práctico de 8.° — Ecuaciones de primer grado
1) Resolvé: 2(x + 3) = 10
2) Resolvé: (x - 1)/3 = x - 5
3) Ana tiene el doble de figuritas que Bruno. Entre los dos tienen 36. ¿Cuántas figuritas tiene Bruno?`;

// Input: a PDF or photos of the práctico, or its text pasted. Difficulty adjustments start off:
// with them off the adaptation keeps the same task, data and difficulty.
export function AdapterForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (input: AdaptInput) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [ajustes, setAjustes] = useState<Adjustment[]>([]);
  const [keep, setKeep] = useState("");

  const issue = files.length > 0 ? uploadIssue(files) : null;
  const needsItems = ajustes.includes("menos_items") && keep.trim() === "";
  const empty = files.length === 0 && text.trim() === "";
  const canSubmit = !disabled && !issue && !empty && !needsItems;

  function toggle(a: Adjustment) {
    setAjustes((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  return (
    <form
      className={`${card} space-y-6 print:hidden`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        const keepItems = keep.split(",").map((s) => s.trim()).filter(Boolean);
        onSubmit({ files, text: text.trim() || undefined, ajustes, keepItems });
      }}
    >
      <div className="space-y-3">
        <h2 className="text-2xl font-bold">1. Subí el práctico</h2>
        <label
          className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-500 bg-slate-50 px-4 py-6 text-center text-lg hover:bg-slate-100 ${focusWithin}`}
        >
          <span className="font-semibold text-indigo-800 underline underline-offset-4">Elegí un PDF o fotos</span>
          <span className="text-base text-slate-700">Hasta {MAX_FILES} archivos y 4 MB en total: PDF, JPG, PNG o WebP.</span>
          <input
            type="file"
            multiple
            accept={ACCEPTED.join(",")}
            className="sr-only"
            disabled={disabled}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setFiles((prev) => [...prev, ...picked]);
              e.target.value = "";
            }}
          />
        </label>
        {files.length > 0 && (
          <ul className="space-y-1" aria-label="Archivos elegidos">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 text-lg">
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-red-800 hover:bg-red-50"
                >
                  Sacar<span className="sr-only"> {f.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {issue && (
          <p role="alert" className="text-lg font-semibold text-red-800">
            {issue}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="practico-texto" className="block text-lg font-semibold">
          O pegá el texto del práctico
        </label>
        <textarea
          id="practico-texto"
          rows={6}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          className={field}
          placeholder="1) Resolvé: 2(x + 3) = 10"
        />
        <button type="button" disabled={disabled} onClick={() => setText(EXAMPLE)} className={secondaryButton}>
          Probar con un ejemplo
        </button>
      </div>

      <details className="rounded-xl border-2 border-slate-200 p-4">
        <summary className="min-h-11 cursor-pointer text-lg font-semibold">
          Ajustes de dificultad <span className="font-normal text-slate-700">(apagados: la dificultad no cambia)</span>
        </summary>
        <p className="mt-2 max-w-prose text-base text-slate-700">
          Usalos solo si la adecuación de un estudiante lo pide. Las versiones quedan marcadas como «dificultad
          modificada».
        </p>
        <fieldset className="mt-3 space-y-1">
          <legend className="sr-only">Ajustes de dificultad</legend>
          {ADJUSTMENTS.map((a) => (
            <label key={a} className={`flex min-h-11 items-center gap-3 rounded-lg px-2 text-lg hover:bg-slate-50 ${focusWithin}`}>
              <input
                type="checkbox"
                className="size-5 accent-indigo-700"
                checked={ajustes.includes(a)}
                disabled={disabled}
                onChange={() => toggle(a)}
              />
              {ADJUSTMENT_LABELS[a]}
            </label>
          ))}
        </fieldset>
        {ajustes.includes("menos_items") && (
          <div className="mt-3 space-y-1">
            <label htmlFor="practico-items" className="block text-lg font-semibold">
              Ejercicios que quedan
            </label>
            <input
              id="practico-items"
              value={keep}
              disabled={disabled}
              onChange={(e) => setKeep(e.target.value)}
              aria-invalid={needsItems}
              aria-describedby="practico-items-ayuda"
              className={field}
              placeholder="1, 3, 4b"
            />
            <p id="practico-items-ayuda" className="text-base text-slate-700">
              Separados por coma. «2» deja todos los incisos del 2.
            </p>
          </div>
        )}
      </details>

      <button type="submit" disabled={!canSubmit} className={primaryButton}>
        Adaptar práctico
      </button>
    </form>
  );
}
