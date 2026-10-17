"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Breadcrumbs, Loading, NotFound } from "@/components/ui/States";
import { field, focusWithin, inlineLink, primaryButton } from "@/components/ui/styles";
import { FORWARD } from "@/components/ui/transitions";
import type { AssessmentType } from "@/lib/contract";
import { generatePending } from "@/lib/groups/generate";
import { readExercisesPdf } from "@/lib/groups/readPdf";
import { createAssessment, useData } from "@/lib/groups/store";
import { groupByProfiles, topInterests, TYPE_LABEL, versionLabel } from "@/lib/groups/versions";
import { ACCEPTED, uploadIssue } from "@/lib/adapter/upload";
import { splitExercises } from "@/lib/results/exercises";
import { supportLabel } from "@/lib/supports";
import { isSyllabusConfirmed, useSyllabus } from "@/lib/syllabus/store";

// The same chip style for "Tipo" and for where the exercises come from.
const chip = (active: boolean) =>
  `inline-flex min-h-11 cursor-pointer items-center rounded-lg border-2 px-5 py-2 text-lg font-semibold transition-colors ${focusWithin} ${
    active
      ? "border-indigo-700 bg-indigo-700 text-white"
      : "border-slate-500 bg-white text-slate-900 hover:border-slate-800 hover:bg-slate-50"
  }`;

type PdfState =
  | { status: "idle" }
  | { status: "reading"; name: string }
  | { status: "done"; name: string; doubts: string[] }
  | { status: "error"; message: string };

export function NewAssessment() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const data = useData();
  const syllabus = useSyllabus();
  const [type, setType] = useState<AssessmentType>("worksheet");
  const [topic, setTopic] = useState("");
  const [original, setOriginal] = useState("");
  const [useInterests, setUseInterests] = useState(true);
  // By default the teacher uploads the PDF they already have; typing the exercises is the alternative.
  const [source, setSource] = useState<"pdf" | "text">("pdf");
  const [pdf, setPdf] = useState<PdfState>({ status: "idle" });
  // "Menos ítems": by version, the exercise numbers the teacher left out. Empty: the version keeps them all.
  const [dropped, setDropped] = useState<Record<string, number[]>>({});

  if (!data) return <Loading />;
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) return <NotFound what="ese grupo" />;

  const hasInterests = group.students.some((s) => (s.interests ?? []).length > 0);
  const themed = hasInterests && useInterests;
  const versions = groupByProfiles(group.students).map((v) => ({
    ...v,
    key: [...v.profiles, ...v.supports].join("+") || "base",
    interests: themed ? topInterests(group.students.filter((s) => v.studentIds.includes(s.id))) : [],
  }));
  // The original as-is: no profiles, supports or interests. It doesn't go through the AI and always keeps everything.
  const isOriginal = (v: (typeof versions)[number]) =>
    v.profiles.length === 0 && v.supports.length === 0 && v.interests.length === 0;
  const exerciseNumbers = original.trim() ? splitExercises(original).map((e) => e.number) : [];
  const keepOf = (key: string) => {
    const out = dropped[key] ?? [];
    const keep = exerciseNumbers.filter((n) => !out.includes(n));
    return out.length > 0 && keep.length > 0 ? keep : undefined;
  };
  const nameOf = (id: string) => group.students.find((s) => s.id === id)?.name ?? "";
  // With a PDF, there's nothing to generate until the AI read it and the teacher can review the text.
  const waitingPdf = source === "pdf" && pdf.status !== "done";

  const readPdf = async (files: File[]) => {
    const issue = uploadIssue(files);
    if (issue) {
      setPdf({ status: "error", message: issue });
      return;
    }
    setPdf({ status: "reading", name: files.map((f) => f.name).join(", ") });
    setDropped({});
    try {
      const read = await readExercisesPdf(files);
      setOriginal(read.original);
      setPdf({ status: "done", name: read.name, doubts: read.doubts });
    } catch (e) {
      setPdf({ status: "error", message: e instanceof Error ? e.message : "No pudimos leer los archivos. Reintentá." });
    }
  };

  return (
    <>
      <Breadcrumbs
        items={[
          { text: "Mis grupos", href: "/grupos" },
          { text: group.name, href: `/grupos/${group.id}` },
          { text: "Nuevo" },
        ]}
      />
      <h1 className="text-4xl font-bold tracking-tight">Nuevo práctico o parcial para {group.name}</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[3fr_2fr]">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (versions.length === 0 || waitingPdf) return;
            const id = createAssessment({
              groupId: group.id,
              type,
              topic: topic.trim(),
              original,
              // The unadapted version without interests is the original as-is: it doesn't go through the AI.
              versions: versions.map(({ key, ...v }) =>
                isOriginal({ key, ...v })
                  ? { ...v, status: "ready", content: original, changes: [], approved: false }
                  : { ...v, keep: keepOf(key), status: "pending", approved: false },
              ),
            });
            void generatePending(id);
            router.push(`/grupos/${group.id}/evaluaciones/${id}`, { transitionTypes: FORWARD });
          }}
        >
          <fieldset>
            <legend className="mb-2 text-lg font-semibold">Tipo</legend>
            <div className="flex gap-3">
              {(Object.keys(TYPE_LABEL) as AssessmentType[]).map((t) => (
                <label key={t} className={chip(type === t)}>
                  <input
                    type="radio"
                    name="type"
                    className="sr-only"
                    checked={type === t}
                    onChange={() => setType(t)}
                  />
                  {TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="topic" className="mb-2 block text-lg font-semibold">
              Tema
            </label>
            <input
              id="topic"
              className={field}
              placeholder="Ej.: Límites de funciones"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
            />
          </div>

          <fieldset>
            <legend className="mb-2 text-lg font-semibold">Ejercicios originales</legend>
            <div className="flex flex-wrap gap-3">
              <label className={chip(source === "pdf")}>
                <input
                  type="radio"
                  name="source"
                  className="sr-only"
                  checked={source === "pdf"}
                  onChange={() => setSource("pdf")}
                />
                Subir PDF o fotos
              </label>
              <label className={chip(source === "text")}>
                <input
                  type="radio"
                  name="source"
                  className="sr-only"
                  checked={source === "text"}
                  onChange={() => setSource("text")}
                />
                Escribirlos
              </label>
            </div>

            {source === "pdf" && (
              <div className="mt-4 space-y-3">
                <label
                  className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-500 bg-white px-6 py-6 text-center transition-colors hover:border-indigo-700 hover:bg-indigo-50 ${focusWithin}`}
                >
                  <input
                    type="file"
                    accept={ACCEPTED.join(",")}
                    multiple
                    className="sr-only"
                    disabled={pdf.status === "reading"}
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])];
                      // Empty again so choosing the same files reads them again.
                      e.target.value = "";
                      if (files.length > 0) void readPdf(files);
                    }}
                  />
                  <span className="text-lg font-semibold">
                    {pdf.status === "done" ? "Elegir otros archivos" : "Elegí el PDF o las fotos del práctico o parcial"}
                  </span>
                  <span className="text-base text-slate-700">
                    {pdf.status === "done"
                      ? pdf.name
                      : "Hasta 4 archivos y 4 MB en total: PDF, JPG, PNG o WebP. La IA lee los ejercicios y vos los revisás antes de generar."}
                  </span>
                </label>

                {pdf.status === "reading" && (
                  <p role="status" className="text-lg font-semibold text-indigo-900">
                    Leyendo {pdf.name}…
                  </p>
                )}
                {pdf.status === "error" && (
                  <p role="alert" className="rounded-lg border-2 border-red-700 bg-red-50 px-4 py-3 text-lg text-red-900">
                    <span className="font-semibold">{pdf.message}</span>{" "}
                    <button type="button" className={inlineLink} onClick={() => setSource("text")}>
                      O escribilos a mano.
                    </button>
                  </p>
                )}
                {pdf.status === "done" && pdf.doubts.length > 0 && (
                  <div className="rounded-lg border-2 border-amber-600 bg-amber-50 px-4 py-3 text-lg text-amber-950">
                    <p className="font-semibold">La IA no está segura de esto:</p>
                    <ul className="mt-1 list-disc space-y-1 pl-6">
                      {pdf.doubts.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {(source === "text" || pdf.status === "done") && (
              <div className="mt-4">
                <label htmlFor="original" className={source === "pdf" ? "mb-1 block text-lg font-semibold" : "sr-only"}>
                  {source === "pdf" ? "Lo que leyó la IA" : "Ejercicios originales"}
                </label>
                <p id="original-help" className="mb-2 text-base text-slate-700">
                  {source === "pdf"
                    ? "Revisá que la IA haya leído bien los ejercicios. Podés corregirlos acá: esto es lo que se adapta."
                    : "Pegalo como lo das siempre. Las fórmulas pueden ir en LaTeX."}
                </p>
                <textarea
                  id="original"
                  className={`${field} min-h-72 font-mono text-base`}
                  aria-describedby="original-help"
                  value={original}
                  onChange={(e) => setOriginal(e.target.value)}
                  required
                />
              </div>
            )}
          </fieldset>

          {hasInterests && (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-lg">
              <input
                type="checkbox"
                className="mt-1.5 size-5 shrink-0 accent-indigo-700"
                checked={useInterests}
                onChange={(e) => setUseInterests(e.target.checked)}
              />
              <span>
                <span className="font-semibold">Orientar los ejercicios a los gustos de los estudiantes</span>
                <span className="block text-base text-slate-700">
                  La IA cambia el contexto de los enunciados, no los números ni lo que se evalúa.
                </span>
              </span>
            </label>
          )}

          <div>
            <button
              type="submit"
              className={primaryButton}
              disabled={versions.length === 0 || waitingPdf}
              aria-describedby={waitingPdf ? "pdf-needed" : undefined}
            >
              Generar {versions.length} {versions.length === 1 ? "versión" : "versiones"}
            </button>
            {waitingPdf && (
              <p id="pdf-needed" className="mt-2 text-base text-slate-700">
                Primero subí el PDF o las fotos y revisá lo que leyó la IA.
              </p>
            )}
          </div>
        </form>

        <aside aria-labelledby="versions-heading" className="h-fit rounded-2xl border-2 border-slate-200 bg-white p-6">
          <h2 id="versions-heading" className="text-2xl font-bold">
            Se van a generar {versions.length} {versions.length === 1 ? "versión" : "versiones"}
          </h2>
          {versions.length === 0 ? (
            <p className="mt-3 text-lg text-slate-700">Primero agregá estudiantes al grupo.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {versions.map((v) => (
                <li key={v.key}>
                  <p className="text-lg font-semibold">
                    {versionLabel(v.profiles, v.supports)}
                    {isOriginal(v) && <span className="font-normal text-slate-700"> (el original)</span>}
                  </p>
                  <p className="text-base text-slate-700">{v.studentIds.map(nameOf).join(", ")}</p>
                  {v.interests.length > 0 && (
                    <p className="text-base text-indigo-900">Gustos: {v.interests.join(", ")}</p>
                  )}
                  {v.supports.length > 0 && (
                    <p className="text-base text-amber-900">
                      Dificultad modificada: {v.supports.map(supportLabel).join(", ").toLowerCase()}
                    </p>
                  )}
                  {!isOriginal(v) && exerciseNumbers.length > 1 && (
                    <LessItems
                      label={versionLabel(v.profiles, v.supports)}
                      numbers={exerciseNumbers}
                      dropped={dropped[v.key] ?? []}
                      onChange={(out) => setDropped((d) => ({ ...d, [v.key]: out }))}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-6 border-t border-slate-200 pt-4 text-base text-slate-700">
            {syllabus && isSyllabusConfirmed(syllabus) ? (
              <>
                El agente usa el temario de{" "}
                <Link href="/materia" className={inlineLink}>
                  Mi materia
                </Link>{" "}
                como contexto.
              </>
            ) : (
              <>
                Todavía no confirmaste el temario.{" "}
                <Link href="/materia" className={inlineLink}>
                  Confirmalo en Mi materia
                </Link>{" "}
                para que el agente respete el alcance de tu curso.
              </>
            )}
          </p>
          <p className="mt-4 text-base text-slate-700">
            A la IA solo le llegan los ejercicios (o el PDF), los perfiles y los gustos, nunca los nombres. Vas a revisar y aprobar cada versión
            antes de descargarla.
          </p>
        </aside>
      </div>
    </>
  );
}

// "Menos ítems": the teacher unticks the exercises this version leaves out. At least one always stays.
function LessItems({
  label,
  numbers,
  dropped,
  onChange,
}: {
  label: string;
  numbers: number[];
  dropped: number[];
  onChange: (dropped: number[]) => void;
}) {
  const kept = numbers.filter((n) => !dropped.includes(n));
  return (
    <details className="mt-2 rounded-lg border-2 border-slate-200 px-3 py-2">
      <summary className="min-h-11 cursor-pointer content-center text-base font-semibold text-indigo-800">
        Menos ítems {dropped.length > 0 ? `(quedan ${kept.length} de ${numbers.length})` : "(todos los ejercicios)"}
      </summary>
      <fieldset className="mt-2 pb-1">
        <legend className="text-base text-slate-700">Ejercicios que quedan en la versión {label}:</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {numbers.map((n) => {
            const checked = !dropped.includes(n);
            return (
              <label key={n} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border-2 border-slate-400 px-3 text-base ${focusWithin}`}>
                <input
                  type="checkbox"
                  className="size-5 accent-indigo-700"
                  checked={checked}
                  disabled={checked && kept.length === 1}
                  onChange={() => onChange(checked ? [...dropped, n] : dropped.filter((d) => d !== n))}
                />
                Ej. {n}
              </label>
            );
          })}
        </div>
      </fieldset>
    </details>
  );
}
