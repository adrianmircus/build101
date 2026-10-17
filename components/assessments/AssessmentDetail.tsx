"use client";

import { useParams } from "next/navigation";
import { addTransitionType, startTransition, useState, ViewTransition } from "react";
import { Breadcrumbs, Loading, NotFound } from "@/components/ui/States";
import { approveButton, field, primaryButton, secondaryButton } from "@/components/ui/styles";
import { TAB_SLIDE } from "@/components/ui/transitions";
import { generatePending } from "@/lib/groups/generate";
import { updateVersion, useData } from "@/lib/groups/store";
import type { Version } from "@/lib/groups/types";
import { TYPE_LABEL, versionLabel } from "@/lib/groups/versions";
import { Grades } from "./Grades";

const STATUS: Record<Version["status"], string> = {
  pending: "Pendiente",
  generating: "Generando…",
  ready: "Para revisar",
  error: "Falló",
};

const STATUS_COLOR: Record<Version["status"], string> = {
  pending: "text-slate-700",
  generating: "font-semibold text-indigo-800",
  ready: "font-semibold text-amber-900",
  error: "font-semibold text-red-800",
};

export function AssessmentDetail() {
  const { groupId, assessmentId } = useParams<{ groupId: string; assessmentId: string }>();
  const data = useData();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);

  if (!data) return <Loading />;
  const group = data.groups.find((g) => g.id === groupId);
  const assessment = data.assessments.find((a) => a.id === assessmentId && a.groupId === groupId);
  if (!group || !assessment) return <NotFound what="ese práctico" />;

  const version = assessment.versions[index] ?? assessment.versions[0];
  const approved = assessment.versions.filter((v) => v.approved).length;
  const names = version.studentIds
    .map((id) => group.students.find((s) => s.id === id)?.name)
    .filter(Boolean);
  const title = `${TYPE_LABEL[assessment.type]}: ${assessment.topic}`;
  const editing = draft !== null;

  return (
    <>
      <div className="print:hidden">
        <Breadcrumbs
          items={[
            { text: "Mis grupos", href: "/grupos" },
            { text: group.name, href: `/grupos/${group.id}` },
            { text: title },
          ]}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
          <p
            className={`rounded-lg border-2 px-4 py-2 text-lg font-semibold ${
              approved === assessment.versions.length
                ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                : "border-amber-600 bg-amber-50 text-amber-900"
            }`}
          >
            {approved === assessment.versions.length && "✓ "}
            {approved} de {assessment.versions.length} versiones aprobadas
          </p>
        </div>

        <h2 className="sr-only">Versiones</h2>
        <ul className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
          {assessment.versions.map((v, i) => {
            const active = v === version;
            return (
              <li key={v.profiles.join("+") || "base"}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    if (i === index) return;
                    // Inside a transition so the version content slides toward the chosen tab.
                    startTransition(() => {
                      addTransitionType(i > index ? "tab-forward" : "tab-back");
                      setIndex(i);
                      setDraft(null);
                    });
                  }}
                  className={`flex w-full flex-col items-start rounded-xl border-2 px-4 py-3 text-left transition-colors sm:w-auto ${
                    active
                      ? "border-indigo-700 bg-indigo-50 ring-2 ring-indigo-700"
                      : "border-slate-300 bg-white hover:border-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-lg font-bold">{versionLabel(v.profiles)}</span>
                  <span className="text-base text-slate-700">
                    {v.studentIds.length} {v.studentIds.length === 1 ? "estudiante" : "estudiantes"} ·{" "}
                    <span className={v.approved ? "font-semibold text-emerald-800" : STATUS_COLOR[v.status]}>
                      {v.approved ? "✓ Aprobada" : STATUS[v.status]}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <ViewTransition key={index} enter={TAB_SLIDE} exit={TAB_SLIDE} default="none">
          <div>
            <p className="mt-6 text-lg text-slate-700">
              <span className="font-semibold">Para:</span> {names.join(", ") || "nadie del grupo actual"}
            </p>
            {version.interests && version.interests.length > 0 && (
              <p className="mt-1 text-lg text-slate-700">
                <span className="font-semibold">Orientada a:</span> {version.interests.join(", ")}
              </p>
            )}

            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <section aria-labelledby="original-heading" className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-6">
                <h3 id="original-heading" className="mb-3 text-xl font-bold text-slate-700">
                  Original
                </h3>
                <div className="whitespace-pre-wrap text-lg leading-relaxed">{assessment.original}</div>
              </section>

              <section
                aria-labelledby="adapted-heading"
                aria-live="polite"
                className="rounded-2xl border-2 border-indigo-700 bg-white p-4 sm:p-6"
              >
                <h3 id="adapted-heading" className="mb-3 text-xl font-bold text-indigo-900">
                  Versión {versionLabel(version.profiles)}
                </h3>
                {version.status === "ready" && editing ? (
                  <>
                    <label htmlFor="draft" className="sr-only">
                      Editar la versión {versionLabel(version.profiles)}
                    </label>
                    <textarea
                      id="draft"
                      className={`${field} min-h-72 font-mono text-base`}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  </>
                ) : version.status === "ready" ? (
                  <div className="whitespace-pre-wrap text-lg leading-relaxed">{version.content}</div>
                ) : version.status === "error" || version.status === "pending" ? (
                  <div className="space-y-4">
                    {version.status === "error" ? (
                      <p role="alert" className="rounded-lg border-2 border-red-700 bg-red-50 px-4 py-3 text-lg font-semibold text-red-900">
                        No se pudo generar esta versión.
                      </p>
                    ) : (
                      <p className="text-lg">Esta versión todavía no se generó.</p>
                    )}
                    <button type="button" className={secondaryButton} onClick={() => void generatePending(assessment.id)}>
                      Generar de nuevo
                    </button>
                  </div>
                ) : (
                  // Skeleton in the shape of the text that is coming. It only pulses without reduced motion.
                  <div role="status" className="space-y-4">
                    <p className="text-lg font-semibold text-indigo-900">El agente está adaptando el práctico…</p>
                    <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
                      <div className="h-4 w-11/12 rounded bg-slate-200" />
                      <div className="h-4 w-9/12 rounded bg-slate-200" />
                      <div className="h-4 w-10/12 rounded bg-slate-200" />
                      <div className="h-4 w-7/12 rounded bg-slate-200" />
                    </div>
                  </div>
                )}
              </section>
            </div>

            {version.status === "ready" && version.questions && version.questions.length > 0 && (
              // What the student will answer with eye gaze. The key is only shown here, so the teacher can check it.
              <section aria-labelledby="questions-heading" className="mt-6 rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-6">
                <h3 id="questions-heading" className="text-xl font-bold">
                  Opción múltiple para responder con la mirada
                </h3>
                <p className="mt-1 text-lg text-slate-700">
                  Revisá que la respuesta correcta esté bien: la calculó la IA. El estudiante no la ve.
                </p>
                <ol className="mt-4 grid gap-4 lg:grid-cols-2">
                  {version.questions.map((q, i) => (
                    <li key={i} className="rounded-xl border-2 border-slate-200 p-4">
                      <p className="text-base font-semibold text-slate-700">Ejercicio {q.exercise}</p>
                      <p className="mt-1 whitespace-pre-wrap text-lg leading-relaxed">{q.stem}</p>
                      <ul className="mt-3 grid grid-cols-2 gap-2">
                        {q.options.map((o) => {
                          const correct = o.id === q.answer;
                          return (
                            <li
                              key={o.id}
                              className={`rounded-lg border-2 px-3 py-2 text-lg ${
                                correct ? "border-emerald-700 bg-emerald-50 font-semibold text-emerald-900" : "border-slate-300"
                              }`}
                            >
                              <span className="font-bold">{o.id})</span> {o.text}
                              {correct && <span className="block text-base">✓ Respuesta correcta</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {version.status === "ready" && (
              <section aria-labelledby="changes-heading" className="mt-6 rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-6">
                <h3 id="changes-heading" className="mb-3 text-xl font-bold">
                  Qué cambió y por qué
                </h3>
                {version.changes && version.changes.length > 0 ? (
                  <ol className="max-w-4xl list-decimal space-y-3 pl-6 text-lg leading-relaxed marker:font-bold">
                    {version.changes.map((c, i) => (
                      <li key={i}>
                        <span className="font-semibold">{c.what}.</span> <span className="text-slate-700">{c.why}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-lg text-slate-700">Ninguno: es el práctico original.</p>
                )}
              </section>
            )}

            {version.status === "ready" && (
              // The teacher's review: only approved versions reach the students. It changes color with the state so it reads from far away.
              <section
                aria-labelledby="review-heading"
                className={`mt-6 rounded-2xl border-2 p-4 sm:p-6 ${
                  editing
                    ? "border-indigo-700 bg-indigo-50"
                    : version.approved
                      ? "border-emerald-700 bg-emerald-50"
                      : "border-amber-600 bg-amber-50"
                }`}
              >
                <h3
                  id="review-heading"
                  className={`text-2xl font-bold ${
                    editing ? "text-indigo-950" : version.approved ? "text-emerald-900" : "text-amber-950"
                  }`}
                >
                  {editing ? "Editando a mano" : version.approved ? "✓ Aprobaste esta versión" : "Falta tu aprobación"}
                </h3>
                <p className="mt-1 text-lg text-slate-800">
                  {editing
                    ? "Al guardar, la versión vuelve a necesitar tu aprobación."
                    : version.approved
                      ? "Tus estudiantes ya la ven y la pueden resolver en la plataforma."
                      : "Revisala y corregila si hace falta. Tus estudiantes no la ven hasta que la apruebes."}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        className={primaryButton}
                        onClick={() => {
                          // Editing by hand invalidates the approval: the new text has to be approved again.
                          updateVersion(assessment.id, index, { content: draft, approved: false });
                          setDraft(null);
                        }}
                      >
                        Guardar cambios
                      </button>
                      <button type="button" className={secondaryButton} onClick={() => setDraft(null)}>
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={secondaryButton} onClick={() => setDraft(version.content ?? "")}>
                        Editar a mano
                      </button>
                      {version.approved ? (
                        <button
                          type="button"
                          className={secondaryButton}
                          onClick={() => updateVersion(assessment.id, index, { approved: false })}
                        >
                          Quitar aprobación
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={approveButton}
                          onClick={() => updateVersion(assessment.id, index, { approved: true })}
                        >
                          ✓ Aprobar y publicar
                        </button>
                      )}
                    </>
                  )}
                </div>
              </section>
            )}
          </div>
        </ViewTransition>

        <Grades assessment={assessment} group={group} />
      </div>
    </>
  );
}
