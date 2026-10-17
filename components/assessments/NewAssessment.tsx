"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Breadcrumbs, Loading, NotFound } from "@/components/ui/States";
import { field, focusWithin, inlineLink, primaryButton } from "@/components/ui/styles";
import { FORWARD } from "@/components/ui/transitions";
import type { AssessmentType } from "@/lib/contract";
import { generatePending } from "@/lib/groups/generate";
import { createAssessment, useData } from "@/lib/groups/store";
import { groupByProfiles, topInterests, TYPE_LABEL, versionLabel } from "@/lib/groups/versions";
import { isSyllabusConfirmed, useSyllabus } from "@/lib/syllabus/store";

export function NewAssessment() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const data = useData();
  const syllabus = useSyllabus();
  const [type, setType] = useState<AssessmentType>("worksheet");
  const [topic, setTopic] = useState("");
  const [original, setOriginal] = useState("");
  const [useInterests, setUseInterests] = useState(true);

  if (!data) return <Loading />;
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) return <NotFound what="ese grupo" />;

  const hasInterests = group.students.some((s) => (s.interests ?? []).length > 0);
  const themed = hasInterests && useInterests;
  const versions = groupByProfiles(group.students).map((v) => ({
    ...v,
    interests: themed ? topInterests(group.students.filter((s) => v.studentIds.includes(s.id))) : [],
  }));
  const nameOf = (id: string) => group.students.find((s) => s.id === id)?.name ?? "";

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
            if (versions.length === 0) return;
            const id = createAssessment({
              groupId: group.id,
              type,
              topic: topic.trim(),
              original,
              // The unadapted version without interests is the original as-is: it doesn't go through the AI.
              versions: versions.map((v) =>
                v.profiles.length === 0 && v.interests.length === 0
                  ? { ...v, status: "ready", content: original, changes: [], approved: false }
                  : { ...v, status: "pending", approved: false },
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
                <label
                  key={t}
                  className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg border-2 px-5 py-2 text-lg font-semibold transition-colors ${focusWithin} ${
                    type === t
                      ? "border-indigo-700 bg-indigo-700 text-white"
                      : "border-slate-500 bg-white text-slate-900 hover:border-slate-800 hover:bg-slate-50"
                  }`}
                >
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

          <div>
            <label htmlFor="original" className="mb-1 block text-lg font-semibold">
              Ejercicios originales
            </label>
            <p id="original-help" className="mb-2 text-base text-slate-700">
              Pegalo como lo das siempre. Las fórmulas pueden ir en LaTeX.
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

          <button type="submit" className={primaryButton} disabled={versions.length === 0}>
            Generar {versions.length} {versions.length === 1 ? "versión" : "versiones"}
          </button>
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
                <li key={v.profiles.join("+") || "base"}>
                  <p className="text-lg font-semibold">
                    {versionLabel(v.profiles)}
                    {v.profiles.length === 0 && v.interests.length === 0 && (
                      <span className="font-normal text-slate-700"> (el original)</span>
                    )}
                  </p>
                  <p className="text-base text-slate-700">{v.studentIds.map(nameOf).join(", ")}</p>
                  {v.interests.length > 0 && (
                    <p className="text-base text-indigo-900">Gustos: {v.interests.join(", ")}</p>
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
            A la IA solo le llegan los ejercicios, los perfiles y los gustos, nunca los nombres. Vas a revisar y aprobar cada versión
            antes de descargarla.
          </p>
        </aside>
      </div>
    </>
  );
}
