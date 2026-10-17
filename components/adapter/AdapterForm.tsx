"use client";

import { useState } from "react";
import { card, field, focusWithin, primaryButton, secondaryButton } from "@/components/ui/styles";
import {
  ADJUSTMENT_LABELS,
  BASE_FORMATS,
  cleanInterests,
  FORMAT_LABELS,
  MAX_INTERESTS,
  REASONING_ADJUSTMENTS,
  type Adjustment,
  type Format,
} from "@/lib/adapter/adapt-schemas";
import { ACCEPTED, MAX_FILES, uploadIssue } from "@/lib/adapter/upload";

export type AdaptInput = {
  files: File[];
  text?: string;
  ajustes: Adjustment[];
  keepItems: string[];
  razonamientoEn: Format[];
  intereses: string[];
};

const EXAMPLE = `Práctico de 8.° — Ecuaciones de primer grado
1) Resolvé: 2(x + 3) = 10
2) Resolvé: (x - 1)/3 = x - 5
3) Ana tiene el doble de figuritas que Bruno. Entre los dos tienen 36. ¿Cuántas figuritas tiene Bruno?`;

// Where the reasoning supports go: their own version (on by default) and, optionally, the three base versions.
const TARGETS: Format[] = ["razonamiento", ...BASE_FORMATS];
const TARGET_LABELS: Record<Format, string> = {
  ...FORMAT_LABELS,
  razonamiento: "Versión propia de razonamiento disminuido",
};
const SUGGESTED_INTERESTS = ["cocina", "fútbol", "música", "videojuegos", "animales"];

const checkRow = `flex min-h-11 items-center gap-3 rounded-lg px-2 text-lg hover:bg-slate-50 ${focusWithin}`;
const panel = "rounded-xl border-2 border-slate-200 p-4";

// Input: a PDF or photos of the práctico, or its text pasted. Everything for a specific student starts off:
// with it off the adaptation keeps the same task, data and difficulty.
export function AdapterForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (input: AdaptInput) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [reasoning, setReasoning] = useState<Adjustment[]>([]);
  const [targets, setTargets] = useState<Format[]>(["razonamiento"]);
  const [fewer, setFewer] = useState(false);
  const [keep, setKeep] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [interestDraft, setInterestDraft] = useState("");

  const issue = files.length > 0 ? uploadIssue(files) : null;
  const needsItems = fewer && keep.trim() === "";
  const needsTarget = reasoning.length > 0 && targets.length === 0;
  const empty = files.length === 0 && text.trim() === "";
  const canSubmit = !disabled && !issue && !empty && !needsItems && !needsTarget;
  const fullInterests = interests.length >= MAX_INTERESTS;

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  function addInterest(raw: string) {
    setInterests((prev) => cleanInterests([...prev, raw]));
    setInterestDraft("");
  }

  return (
    <form
      className={`${card} space-y-6 print:hidden`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        const keepItems = keep.split(",").map((s) => s.trim()).filter(Boolean);
        onSubmit({
          files,
          text: text.trim() || undefined,
          ajustes: [...reasoning, ...(fewer ? (["menos_items"] as const) : [])],
          keepItems: fewer ? keepItems : [],
          razonamientoEn: reasoning.length > 0 ? targets : [],
          intereses: interests,
        });
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

      <div className="space-y-3">
        <h2 className="text-2xl font-bold">
          Para un estudiante <span className="text-lg font-normal text-slate-700">(opcional)</span>
        </h2>

        <details className={panel}>
          <summary className="min-h-11 cursor-pointer text-lg font-semibold">
            Razonamiento disminuido{" "}
            <span className="font-normal text-slate-700">
              {reasoning.length > 0 ? `(${reasoning.length} apoyos)` : "(apagado: la dificultad no cambia)"}
            </span>
          </summary>
          <p className="mt-2 max-w-prose text-base text-slate-700">
            Apoyos para razonar el ejercicio, si la adecuación del estudiante lo pide. Las versiones que los llevan quedan
            marcadas como «dificultad modificada».
          </p>
          <fieldset className="mt-3 space-y-1">
            <legend className="text-lg font-semibold">Apoyos</legend>
            {REASONING_ADJUSTMENTS.map((a) => (
              <label key={a} className={checkRow}>
                <input
                  type="checkbox"
                  className="size-5 accent-indigo-700"
                  checked={reasoning.includes(a)}
                  disabled={disabled}
                  onChange={() => setReasoning((prev) => toggle(prev, a))}
                />
                {ADJUSTMENT_LABELS[a]}
              </label>
            ))}
          </fieldset>
          {reasoning.length > 0 && (
            <fieldset className="mt-4 space-y-1" aria-describedby={needsTarget ? "razonamiento-destino-error" : undefined}>
              <legend className="text-lg font-semibold">¿En qué versiones van?</legend>
              {TARGETS.map((f) => (
                <label key={f} className={checkRow}>
                  <input
                    type="checkbox"
                    className="size-5 accent-indigo-700"
                    checked={targets.includes(f)}
                    disabled={disabled}
                    onChange={() => setTargets((prev) => toggle(prev, f))}
                  />
                  {TARGET_LABELS[f]}
                </label>
              ))}
              {needsTarget && (
                <p id="razonamiento-destino-error" className="text-base font-semibold text-red-800">
                  Elegí al menos una versión.
                </p>
              )}
            </fieldset>
          )}
        </details>

        <details className={panel}>
          <summary className="min-h-11 cursor-pointer text-lg font-semibold">
            Intereses del estudiante{" "}
            <span className="font-normal text-slate-700">
              {interests.length > 0 ? `(${interests.join(", ")})` : "(apagado)"}
            </span>
          </summary>
          <p className="mt-2 max-w-prose text-base text-slate-700">
            Los problemas con texto se reescriben con sus temas. Los números, las relaciones y la pregunta quedan iguales,
            y el verificador lo controla. Las ecuaciones no cambian.
          </p>
          {interests.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Intereses elegidos">
              {interests.map((i) => (
                <li key={i} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 pl-4 text-lg text-indigo-950">
                  {i}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setInterests((prev) => prev.filter((x) => x !== i))}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full font-bold text-indigo-800 hover:bg-indigo-100"
                  >
                    <span aria-hidden="true">×</span>
                    <span className="sr-only">Sacar {i}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1 space-y-1">
              <label htmlFor="practico-interes" className="block text-lg font-semibold">
                Agregá un interés
              </label>
              <input
                id="practico-interes"
                value={interestDraft}
                maxLength={40}
                disabled={disabled || fullInterests}
                onChange={(e) => setInterestDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (interestDraft.trim()) addInterest(interestDraft);
                  }
                }}
                className={field}
                placeholder="cocina"
              />
            </div>
            <button
              type="button"
              disabled={disabled || fullInterests || !interestDraft.trim()}
              onClick={() => addInterest(interestDraft)}
              className={secondaryButton}
            >
              Agregar
            </button>
          </div>
          <p className="mt-2 text-base text-slate-700">
            {fullInterests ? `Hasta ${MAX_INTERESTS} intereses.` : "Sugerencias:"}
          </p>
          {!fullInterests && (
            <div className="mt-1 flex flex-wrap gap-2">
              {SUGGESTED_INTERESTS.filter((s) => !interests.includes(s)).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={disabled}
                  onClick={() => addInterest(s)}
                  className="inline-flex min-h-11 items-center rounded-full border-2 border-indigo-200 px-4 text-lg text-indigo-900 hover:bg-indigo-50"
                >
                  + {s}
                </button>
              ))}
            </div>
          )}
        </details>

        <details className={panel}>
          <summary className="min-h-11 cursor-pointer text-lg font-semibold">
            Menos ítems <span className="font-normal text-slate-700">{fewer ? "(activado)" : "(apagado)"}</span>
          </summary>
          <label className={`mt-2 ${checkRow}`}>
            <input
              type="checkbox"
              className="size-5 accent-indigo-700"
              checked={fewer}
              disabled={disabled}
              onChange={() => setFewer((v) => !v)}
            />
            {ADJUSTMENT_LABELS.menos_items}
          </label>
          {fewer && (
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
      </div>

      <button type="submit" disabled={!canSubmit} className={primaryButton}>
        Adaptar práctico
      </button>
    </form>
  );
}
