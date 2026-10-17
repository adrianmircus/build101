"use client";

import { useState } from "react";
import { AiProgress } from "@/components/ui/AiProgress";
import { primaryButton, secondaryButton } from "@/components/ui/styles";
import type { Group, GroupAnalysis } from "@/lib/groups/types";
import { analyzeGroup } from "@/lib/results/analyze";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

// The AI reads the corrections and writes a draft for the teacher. Read only: it doesn't send anything to anyone.
export function AiAnalysis({ group, analysis }: { group: Group; analysis?: GroupAnalysis }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run() {
    setState({ kind: "loading" });
    try {
      await analyzeGroup(group);
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "No pudimos analizar los resultados. Reintentá." });
    }
  }

  return (
    <section aria-labelledby="ai-heading" className="rounded-2xl border-2 border-indigo-300 bg-indigo-50/60 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="ai-heading" className="text-2xl font-bold tracking-tight">
            Análisis con IA
          </h3>
          <p className="mt-1 max-w-2xl text-base text-slate-700">
            A la IA le llegan solo las correcciones, con los estudiantes como E1, E2…: nunca nombres, perfiles ni tus
            devoluciones.
          </p>
        </div>
        <button
          type="button"
          className={analysis ? secondaryButton : primaryButton}
          disabled={state.kind === "loading"}
          onClick={() => void run()}
        >
          {state.kind === "loading" ? "Analizando…" : analysis ? "Volver a analizar" : "Analizar con IA"}
        </button>
      </div>

      {state.kind === "loading" && (
        <div className="mt-4">
          <AiProgress
            title="La IA está leyendo las correcciones"
            seconds={25}
            steps={["Juntando las correcciones del grupo", "Buscando los errores que se repiten", "Escribiendo el resumen"]}
          />
        </div>
      )}
      <div role="status" aria-live="polite">
        {state.kind === "error" && <p className="mt-4 text-lg font-semibold text-red-800">{state.message}</p>}
      </div>

      {analysis && state.kind !== "loading" && (
        <div className="mt-5 space-y-4">
          <p className="inline-flex rounded-md border-2 border-amber-600 bg-amber-50 px-2.5 py-0.5 text-base font-semibold text-amber-950">
            Borrador de la IA: revisalo ·{" "}
            {new Date(analysis.createdAt).toLocaleString("es-UY", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="text-lg">{analysis.summary}</p>
          {analysis.difficulties.length > 0 && (
            <div>
              <h4 className="mb-2 text-lg font-bold">Dificultades principales</h4>
              <ul className="space-y-2 text-lg">
                {analysis.difficulties.map((d, i) => (
                  <li key={i}>
                    <span className="font-semibold">{d.topic}.</span> <span className="text-slate-700">{d.evidence}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analysis.students.length > 0 && (
            <p className="text-base text-slate-700">El resumen de cada estudiante aparece en su detalle, más abajo.</p>
          )}
        </div>
      )}
    </section>
  );
}
