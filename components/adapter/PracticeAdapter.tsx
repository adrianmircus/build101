"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { card, secondaryButton } from "@/components/ui/styles";
import { runAdapt, speak, stopSpeaking } from "@/lib/adapter/adapt-client";
import type { AdaptResult } from "@/lib/adapter/adapt-pipeline";
import { FORMAT_LABELS, FORMATS, isReasoning, type Format, type MathObject } from "@/lib/adapter/adapt-schemas";
import { AdaptedVersion, type Speech } from "./AdaptedVersion";
import { AdapterForm, type AdaptInput } from "./AdapterForm";
import { AdapterProgress, INITIAL_PROGRESS, STAGE_TEXT, type Progress } from "./AdapterProgress";
import { MathText } from "./MathText";

type Run =
  | { kind: "idle" }
  | { kind: "running"; progress: Progress }
  // The práctico is read and the versions are arriving: each one can be reviewed as soon as it is ready.
  | { kind: "partial"; result: AdaptResult; pending: Format[]; progress: Progress }
  | { kind: "done"; result: AdaptResult }
  | { kind: "error"; message: string }
  | { kind: "out_of_scope"; reason: string };

type Tab = Format | "original";
const TAB_LABELS: Record<Tab, string> = { ...FORMAT_LABELS, original: "Original" };
const NONE_APPROVED: Record<Format, boolean> = { lectura_facil: false, dislexia: false, lector_pantalla: false, razonamiento: false };

// One voice at a time, only from a click, with stop. The button goes back to "Escuchar" when the reading ends.
function useSpeech(): Speech {
  const [playing, setPlaying] = useState<string | null>(null);
  const controls = useRef<ReturnType<typeof speak> | null>(null);
  useEffect(() => () => stopSpeaking(), []);
  return {
    playing,
    toggle(id, text) {
      if (playing === id) {
        controls.current?.stop();
        setPlaying(null);
        return;
      }
      controls.current = speak(text, () => setPlaying((p) => (p === id ? null : p)));
      setPlaying(id);
    },
  };
}

// Teacher's flow: upload → real progress per format → three versions with their checks → approve each one.
export function PracticeAdapter() {
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const [tab, setTab] = useState<Tab>("lectura_facil");
  const [approved, setApproved] = useState(NONE_APPROVED);
  const speech = useSpeech();

  async function start(input: AdaptInput) {
    let progress = INITIAL_PROGRESS;
    let partial: { result: AdaptResult; pending: Format[] } | null = null;
    let finished = false;
    const show = () => setRun(partial ? { kind: "partial", ...partial, progress } : { kind: "running", progress });
    const update = (p: Progress) => {
      progress = p;
      show();
    };
    setApproved(NONE_APPROVED);
    update(INITIAL_PROGRESS);
    try {
      await runAdapt(input, (e) => {
        switch (e.stage) {
          case "leyendo":
            break;
          case "preparado":
            partial = { result: e.result, pending: e.pending };
            setTab("lectura_facil");
            update({ ...progress, reading: "done" });
            break;
          case "clave":
            if (partial) partial = { ...partial, result: { ...partial.result, answerKey: e.answerKey } };
            show();
            break;
          case "adaptando":
          case "verificando":
          case "reintentando":
            update({ reading: "done", formats: { ...progress.formats, [e.format]: { stage: e.stage } } });
            break;
          case "formato_listo": {
            const r = e.result;
            const ok = r.checks.filter((c) => c.ok).length;
            if (partial) {
              const ready = [...partial.result.formats, r];
              partial = { result: { ...partial.result, formats: ready }, pending: partial.pending.filter((f) => f !== r.format) };
              // If the open tab is still being prepared, jump to the version that just arrived.
              setTab((t) => (t !== "original" && !ready.some((x) => x.format === t) ? r.format : t));
            }
            update({ reading: "done", formats: { ...progress.formats, [r.format]: { stage: "lista", ok, total: r.checks.length } } });
            break;
          }
          case "listo":
            finished = true;
            setRun({ kind: "done", result: e.result });
            break;
          case "fuera_de_alcance":
            finished = true;
            setRun({ kind: "out_of_scope", reason: e.reason });
            break;
          case "error":
            finished = true;
            setRun({ kind: "error", message: e.message });
            break;
        }
      });
      if (!finished) setRun({ kind: "error", message: "Se cortó la conexión antes de terminar. Probá de nuevo." });
    } catch {
      setRun({ kind: "error", message: "No pudimos conectarnos con el servidor. Probá de nuevo." });
    }
  }

  if (run.kind === "done" || run.kind === "partial") {
    return (
      <Results
        result={run.result}
        pending={run.kind === "partial" ? run.pending : []}
        progress={run.kind === "partial" ? run.progress : null}
        tab={tab}
        onTab={setTab}
        approved={approved}
        onApproved={(f, value) => setApproved((prev) => ({ ...prev, [f]: value }))}
        speech={speech}
        onRestart={() => {
          stopSpeaking();
          setRun({ kind: "idle" });
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <AdapterForm disabled={run.kind === "running"} onSubmit={start} />
      {run.kind === "running" && <AdapterProgress progress={run.progress} />}
      {run.kind === "error" && (
        <p role="alert" className="rounded-xl border-2 border-red-700 bg-red-50 p-4 text-lg font-semibold text-red-900">
          {run.message}
        </p>
      )}
      {run.kind === "out_of_scope" && (
        <div role="alert" className="rounded-xl border-2 border-amber-600 bg-amber-50 p-4 text-lg text-amber-950">
          <p className="font-semibold">Este práctico no se puede adaptar todavía.</p>
          <p className="mt-1">{run.reason}</p>
        </div>
      )}
    </div>
  );
}

function Results({
  result,
  pending,
  progress,
  tab,
  onTab,
  approved,
  onApproved,
  speech,
  onRestart,
}: {
  result: AdaptResult;
  pending: Format[]; // versions still being prepared
  progress: Progress | null; // null when everything arrived
  tab: Tab;
  onTab: (t: Tab) => void;
  approved: Record<Format, boolean>;
  onApproved: (f: Format, value: boolean) => void;
  speech: Speech;
  onRestart: () => void;
}) {
  const math = useMemo(
    () => new Map<string, MathObject>(result.extraction.items.flatMap((it) => it.math.map((m) => [m.id, m] as const))),
    [result],
  );
  // Tabs in a fixed order, for the versions that came out or are on their way (razonamiento disminuido only when asked for).
  const formats = FORMATS.filter((f) => result.formats.some((r) => r.format === f) || pending.includes(f));
  const tabs: Tab[] = [...formats, "original"];
  const done = formats.filter((f) => approved[f]).length;
  const running = pending.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <p className="text-xl" aria-live="polite">
          {running
            ? `Adaptando: ${result.formats.length} de ${formats.length} versiones listas. Ya podés revisar las que llegaron.`
            : `Listo en ${Math.round(result.ms.total / 1000)} s. Aprobaste ${done} de ${formats.length} versiones.`}
        </p>
        <button type="button" className={secondaryButton} onClick={onRestart} disabled={running}>
          Adaptar otro práctico
        </button>
      </div>
      {result.intereses.length > 0 && (
        <p className="text-lg text-slate-800 print:hidden">
          Problemas con texto llevados a los intereses del estudiante: {result.intereses.join(", ")}.
        </p>
      )}
      {result.omitted.length > 0 && (
        <p className="text-lg text-slate-800 print:hidden">Ejercicios que sacaste: {result.omitted.join(", ")}.</p>
      )}

      <div role="tablist" aria-label="Versiones" className="flex flex-wrap gap-2 border-b-2 border-slate-200 print:hidden">
        {tabs.map((t) => (
          <button
            key={t}
            id={`tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            onClick={() => onTab(t)}
            className={`-mb-0.5 inline-flex min-h-11 items-center gap-2 rounded-t-lg border-2 px-4 text-lg font-semibold ${
              tab === t ? "border-slate-200 border-b-white bg-white text-indigo-950" : "border-transparent text-indigo-800 hover:bg-slate-100"
            }`}
          >
            {TAB_LABELS[t]}
            {t !== "original" && pending.includes(t) && (
              <>
                <span aria-hidden="true" className="text-slate-600">…</span>
                <span className="sr-only">(en preparación)</span>
              </>
            )}
            {t !== "original" && approved[t] && <span className="text-emerald-800">✓</span>}
          </button>
        ))}
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "original" ? (
          <Original result={result} math={math} />
        ) : (
          (() => {
            const fr = result.formats.find((f) => f.format === tab);
            if (!fr && pending.includes(tab)) {
              const stage = progress?.formats[tab]?.stage ?? "esperando";
              return (
                <p className={`${card} text-xl`}>
                  Esta versión se está preparando: {STAGE_TEXT[stage].toLocaleLowerCase("es")}
                </p>
              );
            }
            if (!fr) return <p className="text-lg">Esta versión no llegó. Probá adaptar de nuevo.</p>;
            return (
              <AdaptedVersion
                key={tab}
                result={fr}
                math={math}
                modified={fr.dificultad_modificada}
                notApplied={result.no_aplicados.filter(
                  (n) => !isReasoning(n.ajuste) || result.razonamiento_en.length === 0 || result.razonamiento_en.includes(tab),
                )}
                interests={result.intereses}
                approved={approved[tab]}
                onApprove={() => onApproved(tab, true)}
                onReopen={() => onApproved(tab, false)}
                speech={speech}
              />
            );
          })()
        )}
      </div>
    </div>
  );
}

// The práctico as the AI read it, with the answer key computed without AI: to check the reading before approving.
function Original({ result, math }: { result: AdaptResult; math: Map<string, MathObject> }) {
  const ex = result.extraction;
  return (
    <article className={`${card} space-y-4 text-xl leading-relaxed`}>
      <p className="text-lg text-slate-700">Así leyó la IA tu práctico. Si algo está mal leído, las versiones también.</p>
      <h3 className="text-2xl font-bold">{ex.title}</h3>
      {ex.general_instructions && (
        <p>
          <MathText text={ex.general_instructions} math={math} />
        </p>
      )}
      {blocks(ex.items).map((b, i) => (
        <section key={`${i}-${b.block}`} className="space-y-3">
          {b.block && (
            <h4 className="font-semibold">
              <MathText text={b.block} math={math} />
            </h4>
          )}
          <ol className="space-y-4">
            {b.items.map((it) => {
              const key = result.answerKey.find((a) => a.id === it.id);
              return (
                <li key={it.id} className="space-y-1">
                  <p>
                    <span className="font-bold">{it.id}) </span>
                    <MathText text={it.text} math={math} />
                  </p>
                  {it.figure && <p className="text-lg text-slate-800">Figura: {it.figure}</p>}
                  {it.unsure && <p className="text-lg font-semibold text-amber-900">La IA dudó al leer este ejercicio: revisalo.</p>}
                  {key && key.solution !== "—" && (
                    <p className="text-lg text-slate-800">Solución calculada sin IA: {key.solution}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </article>
  );
}

// Consecutive items that share a block's common instruction ("EJERCICIO 2 - Resuelve…") go under one heading.
function blocks(items: AdaptResult["extraction"]["items"]) {
  const out: { block: string; items: typeof items }[] = [];
  for (const it of items) {
    const block = it.block.trim();
    const last = out.at(-1);
    if (last && last.block === block) last.items.push(it);
    else out.push({ block, items: [it] });
  }
  return out;
}
