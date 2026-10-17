"use client";

import { useRef, useState } from "react";
import { AiProgress } from "@/components/ui/AiProgress";
import { Loading } from "@/components/ui/States";
import { approveButton, card, field, focusWithin, secondaryButton } from "@/components/ui/styles";
import type { SyllabusPdfResponse, SyllabusUnitsResponse } from "@/lib/contract";
import {
  confirmSyllabus,
  isSyllabusConfirmed,
  setCourseInfo,
  setGeneratedUnits,
  setPdf,
  updateUnit,
  useSyllabus,
  type Syllabus,
} from "@/lib/syllabus/store";

// Flow: the teacher uploads the PDF (required) → the agent proposes one unit per section →
// the teacher edits them and confirms. Only then does the agent use the syllabus.
type Status =
  | { kind: "idle" }
  | { kind: "uploading"; name: string }
  | { kind: "reading" }
  | { kind: "error"; message: string };

async function postJson<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? fallback);
  return body as T;
}

export function SyllabusEditor() {
  const syllabus = useSyllabus();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  if (!syllabus) return <Loading />;

  const busy = status.kind === "uploading" || status.kind === "reading";

  async function generateUnits(fileId: string) {
    setStatus({ kind: "reading" });
    try {
      const { units } = await postJson<SyllabusUnitsResponse>(
        "/api/syllabus/units",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId }) },
        "No pudimos leer el programa. Reintentá.",
      );
      setGeneratedUnits(units);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "No pudimos leer el programa. Reintentá." });
    }
  }

  async function upload(file: File) {
    setStatus({ kind: "uploading", name: file.name });
    try {
      const form = new FormData();
      form.append("file", file);
      const pdf = await postJson<SyllabusPdfResponse>(
        "/api/syllabus/pdf",
        { method: "POST", body: form },
        "No pudimos subir el PDF. Reintentá.",
      );
      setPdf(pdf);
      await generateUnits(pdf.fileId);
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "No pudimos subir el PDF. Reintentá." });
    }
  }

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Mi materia</h1>
      <p className="mt-2 max-w-3xl text-xl text-slate-700">
        Subí el programa oficial de tu materia. El agente lo lee y arma las unidades, una por sección. Revisalas,
        corregí lo que haga falta y confirmá: desde ahí el agente las usa como contexto para adaptar cada práctico.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[3fr_2fr]">
        <SyllabusPdf syllabus={syllabus} status={status} busy={busy} onUpload={upload} />
        <CourseInfo syllabus={syllabus} />
      </div>

      <Units syllabus={syllabus} status={status} busy={busy} onRegenerate={generateUnits} />

      {syllabus.units.length > 0 && <Confirmation syllabus={syllabus} busy={busy} />}
    </>
  );
}

function SyllabusPdf({
  syllabus,
  status,
  busy,
  onUpload,
}: {
  syllabus: Syllabus;
  status: Status;
  busy: boolean;
  onUpload: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <section aria-labelledby="pdf-heading" className={`${card} h-fit`}>
      <h2 id="pdf-heading" className="text-2xl font-bold">
        1. Programa oficial
      </h2>
      <p className="mt-2 text-base text-slate-700">
        El PDF del programa de tu materia, hasta 4 MB. Es obligatorio: las unidades salen de acá.
      </p>

      {status.kind === "uploading" && (
        <div className="mt-4">
          <AiProgress title={`Subiendo ${status.name}`} seconds={5} steps={["Subiendo el programa"]} compact />
        </div>
      )}
      <div role="status" className="mt-4 text-lg">
        {status.kind !== "uploading" && syllabus.pdf && (
          <p>
            <span className="font-semibold">Cargado:</span> {syllabus.pdf.name}
          </p>
        )}
      </div>

      <label className={`${syllabus.pdf ? secondaryButton : approveButton} mt-4 cursor-pointer ${focusWithin}`}>
        <input
          ref={input}
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (input.current) input.current.value = "";
            if (
              syllabus.units.length > 0 &&
              !confirm("Al cambiar el PDF se vuelven a armar las unidades y se pierden tus cambios. ¿Seguimos?")
            ) {
              return;
            }
            onUpload(file);
          }}
        />
        {syllabus.pdf ? "Reemplazar PDF" : "Subir PDF"}
      </label>
    </section>
  );
}

function CourseInfo({ syllabus }: { syllabus: Syllabus }) {
  return (
    <section aria-labelledby="subject-heading" className={`${card} h-fit`}>
      <h2 id="subject-heading" className="text-2xl font-bold">
        Materia y curso
      </h2>
      <div className="mt-4 grid gap-4">
        <div>
          <label htmlFor="subject" className="mb-2 block text-lg font-semibold">
            Materia
          </label>
          <input
            id="subject"
            className={field}
            value={syllabus.subject}
            onChange={(e) => setCourseInfo({ subject: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="course" className="mb-2 block text-lg font-semibold">
            Curso
          </label>
          <input
            id="course"
            className={field}
            value={syllabus.course}
            onChange={(e) => setCourseInfo({ course: e.target.value })}
          />
        </div>
      </div>
    </section>
  );
}

function Units({
  syllabus,
  status,
  busy,
  onRegenerate,
}: {
  syllabus: Syllabus;
  status: Status;
  busy: boolean;
  onRegenerate: (fileId: string) => void;
}) {
  const pdf = syllabus.pdf;

  return (
    <section aria-labelledby="units-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="units-heading" className="text-2xl font-bold">
            2. Unidades
          </h2>
          <p className="mt-1 text-base text-slate-700">
            Las arma el agente a partir del programa. Podés corregir títulos y contenidos.
          </p>
        </div>
        {pdf && syllabus.units.length > 0 && (
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={() => {
              if (confirm("Se vuelven a armar las unidades desde el PDF y se pierden tus cambios. ¿Seguimos?")) {
                onRegenerate(pdf.fileId);
              }
            }}
          >
            Volver a armar desde el PDF
          </button>
        )}
      </div>

      {status.kind === "reading" && (
        <AiProgress
          title="Leyendo el programa y armando las unidades"
          seconds={45}
          steps={["Leyendo el programa", "Separando las secciones", "Armando las unidades"]}
        />
      )}
      {status.kind === "error" && (
        <p role="alert" className="rounded-lg border-2 border-red-700 bg-red-50 px-4 py-3 text-lg font-semibold text-red-900">
          {status.message}
        </p>
      )}

      {!pdf && status.kind !== "uploading" && (
        <p className="text-lg text-slate-700">Primero subí el programa: las unidades se arman a partir de él.</p>
      )}

      {pdf && syllabus.units.length === 0 && !busy && (
        <button type="button" className={secondaryButton} onClick={() => onRegenerate(pdf.fileId)}>
          Armar unidades desde el PDF
        </button>
      )}

      {syllabus.units.length > 0 && (
        <ol className="space-y-4">
          {syllabus.units.map((unit, i) => (
            <li key={unit.id} className={card}>
              <label htmlFor={`title-${unit.id}`} className="mb-2 block text-lg font-semibold">
                Unidad {i + 1}
              </label>
              <input
                id={`title-${unit.id}`}
                className={field}
                value={unit.title}
                disabled={busy}
                onChange={(e) => updateUnit(unit.id, { title: e.target.value })}
              />
              <label htmlFor={`contents-${unit.id}`} className="mb-2 mt-4 block text-lg font-semibold">
                Contenidos
              </label>
              <textarea
                id={`contents-${unit.id}`}
                className={`${field} min-h-40 text-base`}
                value={unit.contents}
                disabled={busy}
                onChange={(e) => updateUnit(unit.id, { contents: e.target.value })}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Confirmation({ syllabus, busy }: { syllabus: Syllabus; busy: boolean }) {
  const confirmed = isSyllabusConfirmed(syllabus);

  return (
    <section aria-labelledby="confirm-heading" className={`${card} mt-8`}>
      <h2 id="confirm-heading" className="text-2xl font-bold">
        3. Confirmar
      </h2>
      <div role="status" className="mt-2 text-lg">
        {confirmed ? (
          <p className="font-semibold text-emerald-800">
            Temario confirmado. El agente ya lo usa como contexto para adaptar los prácticos.
          </p>
        ) : (
          <p className="text-slate-700">
            Revisá las unidades y confirmá que está todo bien. Mientras no lo confirmes, el agente no usa el temario.
          </p>
        )}
      </div>
      {!confirmed && (
        <button type="button" className={`${approveButton} mt-4`} disabled={busy} onClick={confirmSyllabus}>
          Confirmar temario
        </button>
      )}
    </section>
  );
}
