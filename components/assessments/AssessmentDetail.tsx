"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Breadcrumbs, Loading, NotFound } from "@/components/ui/States";
import { approveButton, field, primaryButton, secondaryButton } from "@/components/ui/styles";
import { generatePending } from "@/lib/groups/generate";
import { updateVersion, useData } from "@/lib/groups/store";
import type { Version } from "@/lib/groups/types";
import { TYPE_LABEL, versionLabel } from "@/lib/groups/versions";

const STATUS: Record<Version["status"], string> = {
  pending: "Pendiente",
  generating: "Generando…",
  ready: "Para revisar",
  error: "Falló",
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
            { text: "Mis grupos", href: "/groups" },
            { text: group.name, href: `/groups/${group.id}` },
            { text: title },
          ]}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-4xl font-bold">{title}</h1>
          <p
            className={`rounded-full px-4 py-2 text-lg font-semibold ${
              approved === assessment.versions.length ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"
            }`}
          >
            {approved} de {assessment.versions.length} versiones aprobadas
          </p>
        </div>

        <h2 className="sr-only">Versiones</h2>
        <ul className="mt-8 flex flex-wrap gap-3">
          {assessment.versions.map((v, i) => {
            const active = v === version;
            return (
              <li key={v.profiles.join("+") || "base"}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    setIndex(i);
                    setDraft(null);
                  }}
                  className={`flex flex-col items-start rounded-xl border-2 px-4 py-3 text-left ${
                    active ? "border-indigo-700 bg-indigo-50" : "border-slate-300 bg-white hover:border-slate-600"
                  }`}
                >
                  <span className="text-lg font-bold">{versionLabel(v.profiles)}</span>
                  <span className="text-base text-slate-700">
                    {v.studentIds.length} {v.studentIds.length === 1 ? "estudiante" : "estudiantes"} ·{" "}
                    <span className={v.approved ? "font-semibold text-emerald-800" : v.status === "error" ? "text-red-800" : ""}>
                      {v.approved ? "✓ Aprobada" : STATUS[v.status]}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 text-lg text-slate-700">
          <span className="font-semibold">Para:</span> {names.join(", ") || "nadie del grupo actual"}
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="original-heading" className="rounded-2xl border-2 border-slate-200 bg-white p-6">
            <h3 id="original-heading" className="mb-3 text-xl font-bold text-slate-600">
              Original
            </h3>
            <div className="whitespace-pre-wrap text-lg">{assessment.original}</div>
          </section>

          <section
            aria-labelledby="adapted-heading"
            aria-live="polite"
            className="rounded-2xl border-2 border-indigo-300 bg-white p-6"
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
              <div className="whitespace-pre-wrap text-lg">{version.content}</div>
            ) : version.status === "error" || version.status === "pending" ? (
              <div className="space-y-4">
                <p className="text-lg">
                  {version.status === "error" ? "No se pudo generar esta versión." : "Esta versión todavía no se generó."}
                </p>
                <button type="button" className={secondaryButton} onClick={() => void generatePending(assessment.id)}>
                  Generar de nuevo
                </button>
              </div>
            ) : (
              <p className="text-lg text-slate-700 motion-safe:animate-pulse">
                El agente está adaptando el práctico…
              </p>
            )}
          </section>
        </div>

        {version.status === "ready" && (
          <section aria-labelledby="changes-heading" className="mt-6 rounded-2xl border-2 border-slate-200 bg-white p-6">
            <h3 id="changes-heading" className="mb-3 text-xl font-bold">
              Qué cambió y por qué
            </h3>
            {version.changes && version.changes.length > 0 ? (
              <ol className="list-decimal space-y-3 pl-6 text-lg">
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
          <div className="mt-6 flex flex-wrap items-center gap-4">
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
                    ✓ Aprobar esta versión
                  </button>
                )}
                <button
                  type="button"
                  className={primaryButton}
                  disabled={!version.approved}
                  aria-describedby={version.approved ? undefined : "pdf-help"}
                  onClick={() => window.print()}
                >
                  Descargar PDF
                </button>
                {!version.approved && (
                  <span id="pdf-help" className="text-base text-slate-700">
                    Aprobá la versión para habilitar el PDF.
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* The only thing that gets printed: the approved version. The browser's "Save as PDF". */}
      {version.approved && (
        <article className="hidden print:block">
          <h1 className="mb-1 text-2xl font-bold">{title}</h1>
          <p className="mb-6 text-base">{group.name}</p>
          <div className="whitespace-pre-wrap">{version.content}</div>
        </article>
      )}
    </>
  );
}
