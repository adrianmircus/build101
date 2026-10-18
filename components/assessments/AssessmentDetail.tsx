"use client";

import { useParams } from "next/navigation";
import { addTransitionType, startTransition, useState, ViewTransition } from "react";
import { AiProgress } from "@/components/ui/AiProgress";
import { FunctionGraph } from "@/components/ui/FunctionGraph";
import { MathText } from "@/components/ui/MathText";
import { Breadcrumbs, Loading, NotFound } from "@/components/ui/States";
import { approveButton, field, primaryButton, secondaryButton } from "@/components/ui/styles";
import { TAB_SLIDE } from "@/components/ui/transitions";
import { generatePending } from "@/lib/groups/generate";
import { checkNumbers, issueText } from "@/lib/groups/numberCheck";
import { updateVersion, useData } from "@/lib/groups/store";
import type { Version } from "@/lib/groups/types";
import { TYPE_LABEL, versionLabel } from "@/lib/groups/versions";
import { usesGaze, usesVoice } from "@/lib/profiles";
import { supportLabel } from "@/lib/supports";
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
  // If the number check flagged something, approving asks the teacher to confirm they reviewed it.
  const [reviewed, setReviewed] = useState(false);

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
  const label = versionLabel(version.profiles, version.supports);
  const numbers = version.status === "ready" ? checkNumbers(assessment.original, version) : { applies: false as const };
  const flagged = numbers.applies && numbers.issues.length > 0;
  // Written versions go to PDF; eye gaze and dictation are answered on the platform.
  const written = !usesGaze(version.profiles) && !usesVoice(version.profiles);

  // The browser's "Save as PDF" with the print stylesheet: the formulas come out as on screen and the text stays
  // selectable. The document title is the file name it suggests, without the profile: the sheet reaches the student.
  const exportPdf = () => {
    const previous = document.title;
    document.title = `${TYPE_LABEL[assessment.type]} - ${assessment.topic} (versión ${index + 1})`;
    window.addEventListener("afterprint", () => (document.title = previous), { once: true });
    window.print();
  };

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

        {assessment.versions.some((v) => v.status === "pending" || v.status === "generating") && (
          // Real progress: each version arrives on its own.
          <div className="mt-6">
            <AiProgress
              title={`Generando ${assessment.versions.length} ${assessment.versions.length === 1 ? "versión" : "versiones"}`}
              seconds={60}
              rows={assessment.versions.map((v) => ({
                label: versionLabel(v.profiles, v.supports),
                status:
                  v.status === "ready" ? "Lista" : v.status === "error" ? "Falló" : v.status === "generating" ? "Adaptando…" : "En espera",
                done: v.status === "ready",
                failed: v.status === "error",
              }))}
            />
          </div>
        )}

        <h2 className="sr-only">Versiones</h2>
        <ul className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
          {assessment.versions.map((v, i) => {
            const active = v === version;
            return (
              <li key={[...v.profiles, ...(v.supports ?? [])].join("+") || "base"}>
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
                      setReviewed(false);
                    });
                  }}
                  className={`flex w-full flex-col items-start rounded-xl border-2 px-4 py-3 text-left transition-colors sm:w-auto ${
                    active
                      ? "border-indigo-700 bg-indigo-50 ring-2 ring-indigo-700"
                      : "border-slate-300 bg-white hover:border-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-lg font-bold">{versionLabel(v.profiles, v.supports)}</span>
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
            {version.supports && version.supports.length > 0 && (
              <p className="mt-2 inline-block rounded-lg border-2 border-amber-600 bg-amber-50 px-3 py-1 text-lg text-amber-950">
                <span className="font-semibold">Dificultad modificada:</span>{" "}
                {version.supports.map(supportLabel).join(", ").toLowerCase()}
              </p>
            )}
            {version.keep && (
              <p className="mt-1 text-lg text-slate-700">
                <span className="font-semibold">Menos ítems:</span> quedan los ejercicios {version.keep.join(", ")}
              </p>
            )}

            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <section aria-labelledby="original-heading" className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-6">
                <h3 id="original-heading" className="mb-3 text-xl font-bold text-slate-700">
                  Original
                </h3>
                <MathText text={assessment.original} className="text-lg leading-relaxed" />
              </section>

              <section
                aria-labelledby="adapted-heading"
                aria-live="polite"
                className="rounded-2xl border-2 border-indigo-700 bg-white p-4 sm:p-6"
              >
                <h3 id="adapted-heading" className="mb-3 text-xl font-bold text-indigo-900">
                  Versión {label}
                </h3>
                {version.status === "ready" && editing ? (
                  <>
                    <label htmlFor="draft" className="sr-only">
                      Editar la versión {label}
                    </label>
                    <textarea
                      id="draft"
                      className={`${field} min-h-72 font-mono text-base`}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  </>
                ) : version.status === "ready" ? (
                  <MathText text={version.content ?? ""} className="text-lg leading-relaxed" />
                ) : version.status === "error" || version.status === "pending" ? (
                  <div className="space-y-4">
                    {version.status === "error" ? (
                      <div role="alert" className="rounded-lg border-2 border-red-700 bg-red-50 px-4 py-3 text-lg text-red-900">
                        <p className="font-semibold">No se pudo generar esta versión.</p>
                        {version.error && <p className="mt-1">{version.error}</p>}
                      </div>
                    ) : (
                      <p className="text-lg">Esta versión todavía no se generó.</p>
                    )}
                    <button type="button" className={secondaryButton} onClick={() => void generatePending(assessment.id)}>
                      Generar de nuevo
                    </button>
                  </div>
                ) : (
                  <AiProgress
                    title="El agente está adaptando el práctico"
                    seconds={usesGaze(version.profiles) ? 60 : 45}
                    steps={[
                      "Cargando los datos del perfil y el temario",
                      ...(usesGaze(version.profiles)
                        ? ["Armando las preguntas de dos opciones"]
                        : usesVoice(version.profiles)
                          ? ["Pasando las consignas a respuestas habladas"]
                          : ["Adaptando los ejercicios"]),
                      "Anotando qué cambió y por qué",
                    ]}
                  />
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
                      <MathText text={q.stem} className="mt-1 text-lg leading-relaxed" />
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
                              <span className="font-bold">{o.id})</span> <MathText text={o.text} inline />
                              {o.graph && (
                                <span className="mt-2 block">
                                  <FunctionGraph spec={o.graph} size="sm" />
                                </span>
                              )}
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

            {numbers.applies && (
              <section
                aria-labelledby="numbers-heading"
                className={`mt-6 rounded-2xl border-2 p-4 sm:p-6 ${flagged ? "border-amber-600 bg-amber-50" : "border-emerald-700 bg-emerald-50"}`}
              >
                <h3 id="numbers-heading" className={`text-xl font-bold ${flagged ? "text-amber-950" : "text-emerald-900"}`}>
                  {flagged
                    ? `Revisá los números en ${numbers.issues.length} ${numbers.issues.length === 1 ? "ejercicio" : "ejercicios"}`
                    : `✓ Mismos números en ${numbers.checked === 1 ? "el ejercicio" : `los ${numbers.checked} ejercicios`}`}
                </h3>
                <p className="mt-1 text-lg text-slate-800">
                  Lo controla la plataforma, sin IA: cada número del original tiene que seguir en el mismo ejercicio.
                </p>
                {flagged && (
                  <ul className="mt-2 list-disc space-y-1 pl-6 text-lg">
                    {numbers.issues.map((issue) => (
                      <li key={issue.exercise}>{issueText(issue)}</li>
                    ))}
                  </ul>
                )}
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
                        <MathText text={c.what} inline className="font-semibold" />.{" "}
                        <MathText text={c.why} inline className="text-slate-700" />
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
                          setReviewed(false);
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
                        <>
                          {flagged && (
                            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-lg">
                              <input
                                type="checkbox"
                                className="size-5 accent-emerald-700"
                                checked={reviewed}
                                onChange={(e) => setReviewed(e.target.checked)}
                              />
                              Revisé las diferencias de números
                            </label>
                          )}
                          <button
                            type="button"
                            className={approveButton}
                            disabled={flagged && !reviewed}
                            onClick={() => updateVersion(assessment.id, index, { approved: true })}
                          >
                            ✓ Aprobar y publicar
                          </button>
                        </>
                      )}
                      {version.approved && written && (
                        <button type="button" className={primaryButton} onClick={exportPdf}>
                          Exportar a PDF
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!editing && !version.approved && written && (
                  <p className="mt-3 text-base text-slate-700">Aprobala para poder exportarla a PDF.</p>
                )}
              </section>
            )}
          </div>
        </ViewTransition>

        <Grades assessment={assessment} group={group} />
      </div>

      {version.status === "ready" && version.approved && written && (
        // Only for printing / PDF: title, name and date to fill in, and the version. Never the profile's label.
        <article className="hidden print:block">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-4 flex flex-wrap gap-x-10 gap-y-2 text-lg">
            <span>Nombre: ________________________________</span>
            <span>Fecha: ______________</span>
          </p>
          <MathText text={version.content ?? ""} className="print-version mt-8 text-lg leading-relaxed" />
        </article>
      )}
    </>
  );
}
