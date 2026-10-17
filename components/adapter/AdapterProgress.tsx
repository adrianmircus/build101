import { FORMAT_LABELS, FORMATS, type Format } from "@/lib/adapter/adapt-schemas";

export type FormatStage = "esperando" | "adaptando" | "verificando" | "reintentando" | "lista";
export type Progress = {
  reading: "active" | "done";
  // The base versions are always there; "razonamiento" shows up when the stream says it started.
  formats: Partial<Record<Format, { stage: FormatStage; ok?: number; total?: number }>>;
};

export const INITIAL_PROGRESS: Progress = {
  reading: "active",
  formats: { lectura_facil: { stage: "esperando" }, dislexia: { stage: "esperando" }, lector_pantalla: { stage: "esperando" } },
};

const STAGE_TEXT: Record<FormatStage, string> = {
  esperando: "En espera",
  adaptando: "Adaptando…",
  verificando: "Verificando la matemática…",
  reintentando: "Corrigiendo lo que marcó el verificador…",
  lista: "Lista",
};

// Real progress from the stream: one line for reading and one per format. Announced politely to screen readers.
export function AdapterProgress({ progress }: { progress: Progress }) {
  return (
    <section aria-labelledby="progreso-titulo" className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-6 print:hidden">
      <h2 id="progreso-titulo" className="text-2xl font-bold">
        2. Adaptando
      </h2>
      <ol aria-live="polite" className="mt-4 space-y-3 text-lg">
        <Row done={progress.reading === "done"} label="Leer el práctico" status={progress.reading === "done" ? "Listo" : "Leyendo…"} />
        {FORMATS.map((f) => {
          const p = progress.formats[f];
          if (!p) return null;
          const status =
            p.stage === "lista" && p.total !== undefined ? `Lista: ${p.ok} de ${p.total} ejercicios verificados` : STAGE_TEXT[p.stage];
          return <Row key={f} done={p.stage === "lista"} label={FORMAT_LABELS[f]} status={status} />;
        })}
      </ol>
    </section>
  );
}

function Row({ done, label, status }: { done: boolean; label: string; status: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3">
      <span
        aria-hidden="true"
        className={`inline-flex size-7 items-center justify-center rounded-full text-base font-bold ${
          done ? "bg-emerald-700 text-white" : "border-2 border-indigo-700 text-indigo-800"
        }`}
      >
        {done ? "✓" : "…"}
      </span>
      <span className="font-semibold">{label}:</span>
      <span className="text-slate-800">{status}</span>
    </li>
  );
}
