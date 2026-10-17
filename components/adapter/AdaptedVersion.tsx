"use client";

import { useState } from "react";
import { approveButton, secondaryButton } from "@/components/ui/styles";
import { formulaAudio, spokenItem } from "@/lib/adapter/adapt-client";
import type { FormatResult, NotApplied } from "@/lib/adapter/adapt-pipeline";
import { ADJUSTMENT_LABELS, FORMAT_LABELS, type AdaptedItem, type Format, type MathObject } from "@/lib/adapter/adapt-schemas";
import { readabilityLabel } from "@/lib/adapter/readability";
import type { ItemCheck } from "@/lib/adapter/verify";
import { MathText, SpeakerIcon, Tex, mathjsToTex } from "./MathText";

export type Speech = { playing: string | null; toggle: (id: string, text: string) => void };

// Typography per format. Dyslexia: wider letter and word spacing (the measure with evidence); no "dyslexia fonts".
const FORMAT_STYLE: Record<Format, string> = {
  lectura_facil: "text-xl leading-relaxed",
  dislexia: "text-[1.3rem] leading-loose tracking-wide [word-spacing:0.16em]",
  lector_pantalla: "text-2xl leading-relaxed",
  razonamiento: "text-xl leading-relaxed",
};

const PLACEHOLDER = /\{\{(m\d+)\}\}/g;

function plain(text: string, math: Map<string, MathObject>) {
  return text.replace(/\*\*/g, "").replace(PLACEHOLDER, (_, id: string) => math.get(id)?.mathjs ?? "");
}

// Plain text of the version, for "Copiar texto": math in mathjs syntax, one exercise per paragraph.
function versionText(result: FormatResult, math: Map<string, MathObject>) {
  const a = result.adaptation;
  const lines = [a.title, a.general_instructions ? plain(a.general_instructions, math) : ""];
  for (const item of a.items) {
    lines.push(`${item.id}) ${plain(item.text, math)}`);
    item.steps.forEach((s, i) => lines.push(`   Paso ${i + 1}: ${plain(s, math)}`));
    if (item.figure) lines.push(`   Figura: ${plain(item.figure, math)}`);
  }
  return lines.filter(Boolean).join("\n\n");
}

export function AdaptedVersion({
  result,
  math,
  modified,
  notApplied,
  interests = [],
  approved,
  onApprove,
  onReopen,
  speech,
}: {
  result: FormatResult;
  math: Map<string, MathObject>;
  modified: boolean;
  notApplied: NotApplied[];
  interests?: string[];
  approved: boolean;
  onApprove: () => void;
  onReopen: () => void;
  speech: Speech;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [copied, setCopied] = useState(false);
  const { adaptation, checks, header, retried, readability } = result;
  const flagged = checks.filter((c) => !c.ok).length + (header.ok ? 0 : 1);
  const verified = checks.filter((c) => c.ok).length;
  const label = FORMAT_LABELS[result.format];
  const formulaButtons = result.format === "lector_pantalla";

  function playFormula(m: MathObject) {
    const audio = formulaAudio(m, Number(m.id.slice(1)));
    speech.toggle(`${result.format}-${m.id}`, audio.text);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <span className="rounded-lg bg-emerald-50 px-3 py-1 text-lg font-semibold text-emerald-900">
          {verified} de {checks.length} ejercicios con la matemática verificada
        </span>
        {flagged > 0 && (
          <span className="rounded-lg bg-amber-100 px-3 py-1 text-lg font-semibold text-amber-950">
            {flagged} para revisar
          </span>
        )}
        <span className="rounded-lg bg-slate-100 px-3 py-1 text-lg text-slate-800">
          Legibilidad:{" "}
          {readability.after === null
            ? "no aplica (casi todo son fórmulas)"
            : `${readability.before === null ? "" : `${readability.before} → `}${readability.after} (${readabilityLabel(readability.after)})`}
        </span>
      </div>

      {modified && (
        <p className="rounded-xl border-2 border-amber-600 bg-amber-50 p-4 text-lg font-semibold text-amber-950">
          Dificultad modificada: esta versión incluye{" "}
          {result.ajustes.map((a) => ADJUSTMENT_LABELS[a].toLocaleLowerCase("es")).join(", ")}.
        </p>
      )}

      {interests.length > 0 && (
        <p className="rounded-xl border-2 border-indigo-300 bg-indigo-50 p-4 text-lg text-indigo-950 print:hidden">
          <span className="font-semibold">Con los intereses del estudiante ({interests.join(", ")}):</span> los problemas con
          texto cambian de tema, no de números ni de pregunta. Revisá que la situación tenga sentido.
        </p>
      )}

      {notApplied.map((n) => (
        <p key={n.ajuste} className="rounded-xl border-2 border-slate-300 bg-slate-50 p-4 text-lg text-slate-900 print:hidden">
          <span className="font-semibold">«{ADJUSTMENT_LABELS[n.ajuste]}» no se aplicó:</span> {n.reason}.
        </p>
      ))}

      {adaptation.notes_for_teacher && (
        <aside className="rounded-xl bg-slate-100 p-4 text-lg print:hidden">
          <span className="font-semibold">Nota para vos: </span>
          {adaptation.notes_for_teacher}
        </aside>
      )}

      <article className={`rounded-2xl border-2 border-slate-200 bg-white p-6 ${FORMAT_STYLE[result.format]}`}>
        <h3 className="text-[1.4em] font-bold">{adaptation.title}</h3>
        {!header.ok && <Issues issues={header.issues} />}
        {adaptation.general_instructions && (
          <p className="mt-3">
            <MathText text={adaptation.general_instructions} math={math} />
          </p>
        )}
        <ol className="mt-6 space-y-6">
          {adaptation.items.map((item) => (
            <Exercise
              key={item.id}
              item={item}
              check={checks.find((c) => c.id === item.id)}
              retried={retried.includes(item.id)}
              math={math}
              format={result.format}
              speech={speech}
              onFormulaAudio={formulaButtons ? playFormula : undefined}
            />
          ))}
        </ol>
      </article>

      <section aria-label={`Aprobar la versión de ${label}`} className="rounded-2xl border-2 border-slate-200 bg-white p-6 print:hidden">
        {approved ? (
          <div className="space-y-4">
            <p role="status" className="text-xl font-semibold text-emerald-900">
              ✓ Aprobaste la versión de {label}.
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={secondaryButton} onClick={() => window.print()}>
                Imprimir
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={async () => {
                  await navigator.clipboard.writeText(versionText(result, math));
                  setCopied(true);
                }}
              >
                {copied ? "Copiado" : "Copiar texto"}
              </button>
              <button type="button" className={secondaryButton} onClick={onReopen}>
                Volver a revisar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="max-w-prose text-lg text-slate-800">
              Nada le llega a un estudiante sin tu aprobación. Leé la versión y aprobala si{" "}
              {modified
                ? "mantiene el mismo pedido y los mismos datos, y si los apoyos son los que pide la adecuación del estudiante."
                : "mantiene el mismo pedido, los mismos datos y la misma dificultad."}
            </p>
            {flagged > 0 && (
              <label className="flex min-h-11 items-center gap-3 text-lg">
                <input
                  type="checkbox"
                  className="size-5 accent-emerald-700"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                Revisé los {flagged === 1 ? "puntos marcados" : `${flagged} puntos marcados`} y la versión está bien así
              </label>
            )}
            <button type="button" className={approveButton} disabled={flagged > 0 && !reviewed} onClick={onApprove}>
              Aprobar versión de {label}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Exercise({
  item,
  check,
  retried,
  math,
  format,
  speech,
  onFormulaAudio,
}: {
  item: AdaptedItem;
  check: ItemCheck | undefined;
  retried: boolean;
  math: Map<string, MathObject>;
  format: Format;
  speech: Speech;
  onFormulaAudio?: (m: MathObject) => void;
}) {
  const audioId = `${format}-${item.id}`;
  const playing = speech.playing === audioId;
  const s = item.support;
  return (
    <li className="space-y-3 border-t-2 border-slate-100 pt-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-3 text-base print:hidden">
        <span className="font-bold text-slate-900">Ejercicio {item.id}</span>
        {check?.ok ? (
          <span className="rounded-md bg-emerald-700 px-2 py-0.5 font-semibold text-white">Matemática verificada</span>
        ) : (
          <span className="rounded-md bg-amber-600 px-2 py-0.5 font-semibold text-white">Revisar</span>
        )}
        {check?.solution === "ok" && <span className="text-emerald-900">La respuesta coincide con el original</span>}
        {check?.solution === "unchecked" && <span className="text-slate-700">No se pudo comprobar la respuesta</span>}
        {retried && <span className="text-slate-700">Se corrigió una vez</span>}
        <button
          type="button"
          onClick={() => speech.toggle(audioId, spokenItem(item, [...math.values()]))}
          className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold text-indigo-800 hover:bg-indigo-50"
        >
          <SpeakerIcon />
          {playing ? "Detener" : "Escuchar"}
          <span className="sr-only"> el ejercicio {item.id}</span>
        </button>
      </div>
      {check && !check.ok && <Issues issues={check.issues} />}

      <p>
        <span className="hidden font-bold print:inline">{item.id}) </span>
        <MathText text={item.text} math={math} onFormulaAudio={onFormulaAudio} />
      </p>
      {item.steps.length > 0 && (
        <ol className="list-decimal space-y-2 pl-8">
          {item.steps.map((step, i) => (
            <li key={i}>
              <MathText text={step} math={math} onFormulaAudio={onFormulaAudio} />
            </li>
          ))}
        </ol>
      )}
      {item.figure && (
        <p className="rounded-lg bg-slate-50 p-3">
          <span className="font-semibold">Figura: </span>
          <MathText text={item.figure} math={math} />
        </p>
      )}
      {item.glossary.length > 0 && (
        <dl className="space-y-1 rounded-lg bg-slate-50 p-3 text-[0.9em]">
          {item.glossary.map((g) => (
            <div key={g.term}>
              <dt className="inline font-semibold">{g.term}: </dt>
              <dd className="inline">{g.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
      {s && (s.guide.length > 0 || s.reminder || s.example.statement) && (
        <div className="space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-3 text-[0.9em]">
          <p className="font-semibold">Apoyo (dificultad modificada)</p>
          {s.guide.length > 0 && (
            <ol className="list-decimal space-y-1 pl-6">
              {s.guide.map((g, i) => (
                <li key={i}>
                  <MathText text={g} math={math} />
                </li>
              ))}
            </ol>
          )}
          {s.reminder && <p>Recordá: {s.reminder}</p>}
          {s.example.statement && (
            <div>
              <p>Ejemplo resuelto: {s.example.statement}</p>
              <ol className="mt-1 space-y-1 pl-6">
                {s.example.steps.map((step, i) => (
                  <li key={i}>
                    <Tex latex={mathjsToTex(step)} />
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Issues({ issues }: { issues: string[] }) {
  return (
    <ul className="list-disc space-y-1 rounded-lg border-2 border-amber-500 bg-amber-50 py-2 pr-3 pl-8 text-base text-amber-950 print:hidden">
      {issues.map((issue) => (
        <li key={issue}>{issue}</li>
      ))}
    </ul>
  );
}
