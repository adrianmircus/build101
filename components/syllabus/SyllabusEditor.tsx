"use client";

import { useEffect, useRef, useState } from "react";
import { Loading } from "@/components/ui/States";
import { card, dangerButton, field, secondaryButton } from "@/components/ui/styles";
import type { SyllabusPdfResponse } from "@/lib/contract";
import {
  addUnit,
  removePdf,
  removeUnit,
  setCourseInfo,
  setPdf,
  updateUnit,
  useSyllabus,
  type Syllabus,
} from "@/lib/syllabus/store";

export function SyllabusEditor() {
  const syllabus = useSyllabus();
  if (!syllabus) return <Loading />;

  return (
    <>
      <h1 className="text-4xl font-bold">Mi materia</h1>
      <p className="mt-2 max-w-3xl text-xl text-slate-700">
        Cargá el temario una vez. El agente lo usa como contexto para que cada versión adaptada respete el alcance, el
        nivel y la notación de tu curso. Los cambios se guardan solos.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-8">
          <CourseInfo syllabus={syllabus} />
          <Units syllabus={syllabus} />
        </div>
        <SyllabusPdf syllabus={syllabus} />
      </div>
    </>
  );
}

function CourseInfo({ syllabus }: { syllabus: Syllabus }) {
  return (
    <section aria-labelledby="subject-heading" className={card}>
      <h2 id="subject-heading" className="text-2xl font-bold">
        Materia y curso
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
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

function Units({ syllabus }: { syllabus: Syllabus }) {
  // When a unit is added, focus goes to its title.
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (focusId) document.getElementById(`title-${focusId}`)?.focus();
  }, [focusId]);

  return (
    <section aria-labelledby="units-heading" className="space-y-4">
      <h2 id="units-heading" className="text-2xl font-bold">
        Unidades
      </h2>
      {syllabus.units.length === 0 && (
        <p className="text-lg text-slate-700">Todavía no cargaste unidades. Agregá la primera con el botón de abajo.</p>
      )}
      <ol className="space-y-4">
        {syllabus.units.map((unit, i) => (
          <li key={unit.id} className={card}>
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-60 flex-1">
                <label htmlFor={`title-${unit.id}`} className="mb-2 block text-lg font-semibold">
                  Unidad {i + 1}
                </label>
                <input
                  id={`title-${unit.id}`}
                  className={field}
                  placeholder="Título de la unidad"
                  value={unit.title}
                  onChange={(e) => updateUnit(unit.id, { title: e.target.value })}
                />
              </div>
              <button
                type="button"
                className={dangerButton}
                aria-label={`Quitar la unidad ${i + 1}`}
                onClick={() => {
                  if (confirm(`¿Quitar la unidad ${i + 1}${unit.title ? ` (${unit.title})` : ""}?`)) {
                    removeUnit(unit.id);
                  }
                }}
              >
                Quitar
              </button>
            </div>
            <label htmlFor={`contents-${unit.id}`} className="mb-2 mt-4 block text-lg font-semibold">
              Contenidos
            </label>
            <textarea
              id={`contents-${unit.id}`}
              className={`${field} min-h-32 text-base`}
              placeholder="Los temas de la unidad, como figuran en tu programa."
              value={unit.contents}
              onChange={(e) => updateUnit(unit.id, { contents: e.target.value })}
            />
          </li>
        ))}
      </ol>
      <button type="button" className={secondaryButton} onClick={() => setFocusId(addUnit())}>
        Agregar unidad
      </button>
    </section>
  );
}

type UploadState = { kind: "idle" } | { kind: "uploading"; name: string } | { kind: "error"; message: string };

function SyllabusPdf({ syllabus }: { syllabus: Syllabus }) {
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setState({ kind: "uploading", name: file.name });
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/syllabus/pdf", { method: "POST", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "No pudimos subir el PDF. Reintentá.");
      setPdf(body as SyllabusPdfResponse);
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "No pudimos subir el PDF. Reintentá." });
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section aria-labelledby="pdf-heading" className={`${card} h-fit`}>
      <h2 id="pdf-heading" className="text-2xl font-bold">
        Programa oficial (opcional)
      </h2>
      <p className="mt-2 text-base text-slate-700">
        Si tenés el programa en PDF, subilo y el agente lo lee junto con tus unidades. Hasta 4 MB.
      </p>

      <div role="status" className="mt-4 text-lg">
        {state.kind === "uploading" && <p className="text-slate-700">Subiendo {state.name}…</p>}
        {state.kind === "error" && <p className="font-semibold text-red-800">{state.message}</p>}
        {state.kind !== "uploading" && syllabus.pdf && (
          <p>
            <span className="font-semibold">Cargado:</span> {syllabus.pdf.name}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label
          className={`${secondaryButton} cursor-pointer has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-amber-500`}
        >
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            className="sr-only"
            disabled={state.kind === "uploading"}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          {syllabus.pdf ? "Reemplazar PDF" : "Subir PDF"}
        </label>
        {syllabus.pdf && state.kind !== "uploading" && (
          <button type="button" className={dangerButton} onClick={removePdf}>
            Quitar PDF
          </button>
        )}
      </div>
    </section>
  );
}
