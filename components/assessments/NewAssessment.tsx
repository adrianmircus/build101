"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Breadcrumbs, Loading, NotFound } from "@/components/ui/States";
import { field, primaryButton } from "@/components/ui/styles";
import type { AssessmentType } from "@/lib/contract";
import { generatePending } from "@/lib/groups/generate";
import { createAssessment, useData } from "@/lib/groups/store";
import { groupByProfiles, TYPE_LABEL, versionLabel } from "@/lib/groups/versions";
import { isSyllabusLoaded, useSyllabus } from "@/lib/syllabus/store";

export function NewAssessment() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const data = useData();
  const syllabus = useSyllabus();
  const [type, setType] = useState<AssessmentType>("worksheet");
  const [topic, setTopic] = useState("");
  const [original, setOriginal] = useState("");

  if (!data) return <Loading />;
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) return <NotFound what="ese grupo" />;

  const versions = groupByProfiles(group.students);
  const nameOf = (id: string) => group.students.find((s) => s.id === id)?.name ?? "";

  return (
    <>
      <Breadcrumbs
        items={[
          { text: "Mis grupos", href: "/groups" },
          { text: group.name, href: `/groups/${group.id}` },
          { text: "Nuevo" },
        ]}
      />
      <h1 className="text-4xl font-bold">Nuevo práctico o parcial para {group.name}</h1>

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
              // The unadapted version is the original as-is: it doesn't go through the AI.
              versions: versions.map((v) =>
                v.profiles.length === 0
                  ? { ...v, status: "ready", content: original, changes: [], approved: false }
                  : { ...v, status: "pending", approved: false },
              ),
            });
            void generatePending(id);
            router.push(`/groups/${group.id}/assessments/${id}`);
          }}
        >
          <fieldset>
            <legend className="mb-2 text-lg font-semibold">Tipo</legend>
            <div className="flex gap-3">
              {(Object.keys(TYPE_LABEL) as AssessmentType[]).map((t) => (
                <label
                  key={t}
                  className={`cursor-pointer rounded-lg border-2 px-5 py-2 text-lg font-semibold has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-amber-500 ${
                    type === t ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-400 bg-white"
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
            <p id="original-help" className="mb-2 text-base text-slate-600">
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
                    {v.profiles.length === 0 && <span className="font-normal text-slate-600"> (el original)</span>}
                  </p>
                  <p className="text-base text-slate-700">{v.studentIds.map(nameOf).join(", ")}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-6 border-t border-slate-200 pt-4 text-base text-slate-700">
            {syllabus && isSyllabusLoaded(syllabus) ? (
              <>
                El agente usa el temario de{" "}
                <Link href="/subject" className="font-semibold text-indigo-800 underline">
                  Mi materia
                </Link>{" "}
                como contexto.
              </>
            ) : (
              <>
                Todavía no cargaste el temario.{" "}
                <Link href="/subject" className="font-semibold text-indigo-800 underline">
                  Cargalo en Mi materia
                </Link>{" "}
                para que el agente respete el alcance de tu curso.
              </>
            )}
          </p>
          <p className="mt-4 text-base text-slate-600">
            A la IA solo le llegan los ejercicios y los perfiles, nunca los nombres. Vas a revisar y aprobar cada versión
            antes de descargarla.
          </p>
        </aside>
      </div>
    </>
  );
}
