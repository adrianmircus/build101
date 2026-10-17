"use client";

import Link from "next/link";
import { useState } from "react";
import { card, inlineLink, secondaryButton } from "@/components/ui/styles";
import { FORWARD } from "@/components/ui/transitions";
import type { Assessment, Data, Group, Student } from "@/lib/groups/types";
import { TYPE_LABEL } from "@/lib/groups/versions";
import { errorLabel, STATUS_CHIP, STATUS_FILL, STATUSES } from "@/lib/results/catalog";
import { exercisesOf, shorten } from "@/lib/results/exercises";
import {
  accuracy,
  allMarks,
  assessmentsWithResults,
  average,
  errorCounts,
  exerciseStats,
  formatNumber,
  formatPercent,
  scoresOf,
  studentAccuracy,
} from "@/lib/results/metrics";
import { AiAnalysis } from "./AiAnalysis";

const gradeHref = (groupId: string, assessmentId: string) => `/grupos/${groupId}/evaluaciones/${assessmentId}/corregir`;

// Sequential, one hue: darker cell = higher grade. The number is always printed, color only supports it.
function gradeTint(score: number): string {
  if (score >= 9) return "bg-indigo-300";
  if (score >= 7) return "bg-indigo-200";
  if (score >= 5) return "bg-indigo-100";
  return "bg-indigo-50";
}

export function ResultsTab({ group, data }: { group: Group; data: Data }) {
  const results = assessmentsWithResults(data, group.id);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [chartId, setChartId] = useState<string | null>(null);

  if (results.length === 0) return <Empty group={group} data={data} />;

  const scores = scoresOf(results);
  const marks = allMarks(results);
  const groupAverage = average(scores);
  const groupAccuracy = accuracy(marks);
  const selected = group.students.find((s) => s.id === studentId);
  const chartAssessment = results.find((a) => a.id === chartId) ?? results[results.length - 1];

  return (
    <div className="space-y-10">
      <ul className="grid gap-4 sm:grid-cols-3" aria-label="Resumen del grupo">
        <StatTile label="Prácticos con resultados" value={String(results.length)} />
        <StatTile
          label="Promedio del grupo"
          value={groupAverage === null ? "—" : formatNumber(groupAverage)}
          detail={groupAverage === null ? "Todavía sin notas" : `sobre 10 · ${scores.length} notas`}
        />
        <StatTile
          label="Acierto en ejercicios"
          value={groupAccuracy === null ? "—" : formatPercent(groupAccuracy)}
          detail={groupAccuracy === null ? "Todavía sin corrección por ejercicio" : `${marks.length} ejercicios corregidos`}
        />
      </ul>

      <AiAnalysis group={group} analysis={data.analyses?.[group.id]} />

      <section aria-labelledby="grades-table-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 id="grades-table-heading" className="text-2xl font-bold tracking-tight">
            Notas por estudiante
          </h3>
          <p className="text-base text-slate-700">Celda más oscura = nota más alta. Elegí un estudiante para ver su detalle.</p>
        </div>
        <div className="overflow-x-auto rounded-2xl border-2 border-slate-200 bg-white">
          <table className="w-full min-w-max border-collapse text-left text-lg">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Estudiante
                </th>
                {results.map((a) => (
                  <th key={a.id} scope="col" className="px-3 py-3 text-center font-semibold">
                    <Link href={gradeHref(group.id, a.id)} transitionTypes={FORWARD} className={inlineLink}>
                      {shorten(a.topic, 22)}
                    </Link>
                    <span className="block text-sm font-normal text-slate-700">
                      {TYPE_LABEL[a.type]} · {new Date(a.createdAt).toLocaleDateString("es-UY", { day: "numeric", month: "short" })}
                    </span>
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 text-center font-semibold">
                  Promedio
                </th>
              </tr>
            </thead>
            <tbody>
              {group.students.map((s) => {
                const own = scoresOf(results, s.id);
                const avg = average(own);
                const active = s.id === selected?.id;
                return (
                  <tr key={s.id} className={`border-b border-slate-100 last:border-0 ${active ? "bg-amber-50" : ""}`}>
                    <th scope="row" className="px-2 py-1 font-normal">
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setStudentId(active ? null : s.id)}
                        className={`min-h-11 w-full rounded-lg px-2 text-left font-semibold underline-offset-4 hover:underline ${
                          active ? "text-indigo-950" : "text-indigo-800"
                        }`}
                      >
                        {s.name}
                      </button>
                    </th>
                    {results.map((a) => (
                      <GradeCell key={a.id} assessment={a} studentId={s.id} />
                    ))}
                    <td className="px-4 py-2 text-center font-bold">{avg === null ? "—" : formatNumber(avg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <StudentDetail
          group={group}
          student={selected}
          results={results}
          aiSummary={data.analyses?.[group.id]?.students.find((s) => s.studentId === selected.id)?.summary}
          onClose={() => setStudentId(null)}
        />
      )}

      <div className="grid gap-10 xl:grid-cols-[3fr_2fr]">
        <ExerciseChart
          assessments={results}
          assessment={chartAssessment}
          onSelect={setChartId}
          groupId={group.id}
        />
        <ErrorChart assessments={results} />
      </div>
    </div>
  );
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <li className={card}>
      <p className="text-base font-semibold text-slate-700">{label}</p>
      <p className="mt-1 text-4xl font-bold tracking-tight">{value}</p>
      {detail && <p className="mt-1 text-base text-slate-700">{detail}</p>}
    </li>
  );
}

function GradeCell({ assessment, studentId }: { assessment: Assessment; studentId: string }) {
  const grade = assessment.grades?.[studentId];
  const acc = studentAccuracy(assessment, studentId);
  if (!grade && acc === null) {
    return (
      <td className="px-3 py-2 text-center text-slate-500">
        <span aria-label="Sin resultados">—</span>
      </td>
    );
  }
  return (
    <td className="px-1.5 py-1.5 text-center">
      <span
        className={`flex min-h-11 flex-col items-center justify-center rounded-lg px-3 py-1 text-indigo-950 ${
          grade ? gradeTint(grade.score) : "bg-slate-50"
        }`}
      >
        <span className="text-xl font-bold">{grade ? grade.score : "—"}</span>
        {acc !== null && <span className="text-sm">{formatPercent(acc)} acierto</span>}
      </span>
    </td>
  );
}

function StudentDetail({
  group,
  student,
  results,
  aiSummary,
  onClose,
}: {
  group: Group;
  student: Student;
  results: Assessment[];
  aiSummary?: string;
  onClose: () => void;
}) {
  const errors = errorCounts(allMarks(results, student.id)).slice(0, 3);
  const avg = average(scoresOf(results, student.id));

  return (
    <section aria-labelledby="student-detail-heading" className="rounded-2xl border-2 border-amber-500 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="student-detail-heading" className="text-2xl font-bold tracking-tight">
            {student.name}
          </h3>
          <p className="text-lg text-slate-700">
            {avg === null ? "Todavía sin notas" : `Promedio ${formatNumber(avg)}`}
            {errors.length > 0 && ` · le cuesta más: ${errors.map((e) => errorLabel(e.id).toLowerCase()).join(", ")}`}
          </p>
        </div>
        <button type="button" className={secondaryButton} onClick={onClose}>
          Cerrar
        </button>
      </div>

      {aiSummary && (
        <p className="mt-4 rounded-lg bg-indigo-50 px-4 py-3 text-lg">
          <span className="font-semibold">Según la IA (borrador):</span> {aiSummary}
        </p>
      )}

      <ul className="mt-5 space-y-4">
        {results.map((a) => {
          const grade = a.grades?.[student.id];
          const row = a.exerciseResults?.[student.id] ?? [];
          const exercises = exercisesOf(a);
          return (
            <li key={a.id} className="rounded-xl border-2 border-slate-200 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-lg font-semibold">
                  {TYPE_LABEL[a.type]}: {a.topic}
                </p>
                <p className="text-lg">
                  Nota <span className="font-bold">{grade ? grade.score : "—"}</span>
                  {studentAccuracy(a, student.id) !== null && ` · ${formatPercent(studentAccuracy(a, student.id)!)} acierto`}
                </p>
              </div>
              {row.some(Boolean) ? (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Ejercicios">
                  {exercises.map((e, i) => {
                    const r = row[i];
                    const status = r ? STATUSES.find((s) => s.id === r.status)! : null;
                    return (
                      <li
                        key={i}
                        className={`rounded-lg border-2 px-3 py-1 text-base font-semibold ${
                          r ? STATUS_CHIP[r.status] : "border-dashed border-slate-300 text-slate-600"
                        }`}
                      >
                        {e.label} {status ? `${status.symbol} ${status.label}` : "sin corregir"}
                        {r && r.errors.length > 0 && (
                          <span className="font-normal"> · {r.errors.map(errorLabel).join(", ")}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-base text-slate-700">
                  Sin corrección por ejercicio.{" "}
                  <Link href={gradeHref(group.id, a.id)} transitionTypes={FORWARD} className={inlineLink}>
                    Corregir
                  </Link>
                </p>
              )}
              {grade?.feedback && (
                <p className="mt-3 text-base text-slate-700">
                  <span className="font-semibold">Tu devolución:</span> {grade.feedback}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StatusLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-base" aria-label="Referencias">
      {STATUSES.map((s) => (
        <li key={s.id} className="flex items-center gap-2">
          <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-sm ${STATUS_FILL[s.id]}`} />
          {s.symbol} {s.label}
        </li>
      ))}
    </ul>
  );
}

function ExerciseChart({
  assessments,
  assessment,
  onSelect,
  groupId,
}: {
  assessments: Assessment[];
  assessment: Assessment;
  onSelect: (id: string) => void;
  groupId: string;
}) {
  const stats = exerciseStats(assessment);
  const marked = stats.filter((e) => e.accuracy !== null);
  const hardest = marked.length > 1 ? marked.reduce((a, b) => (b.accuracy! < a.accuracy! ? b : a)) : null;

  return (
    <section aria-labelledby="exercise-chart-heading">
      <h3 id="exercise-chart-heading" className="text-2xl font-bold tracking-tight">
        Ejercicios que más costaron
      </h3>
      {assessments.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Elegí el práctico">
          {[...assessments].reverse().map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={a.id === assessment.id}
              onClick={() => onSelect(a.id)}
              className={`min-h-11 rounded-lg border-2 px-3 text-base font-semibold transition-colors ${
                a.id === assessment.id ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-400 bg-white hover:border-slate-700"
              }`}
            >
              {shorten(a.topic, 28)}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4">
        <StatusLegend />
      </div>
      {marked.length === 0 ? (
        <p className="mt-4 text-lg text-slate-700">
          Todavía no corregiste este práctico por ejercicio.{" "}
          <Link href={gradeHref(groupId, assessment.id)} transitionTypes={FORWARD} className={inlineLink}>
            Corregir ahora
          </Link>
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {stats.map((e) => (
            <li key={e.label}>
              <div className="flex items-baseline justify-between gap-x-4">
                <p className="min-w-0 text-lg">
                  <span className="font-bold">{e.label}</span>
                  {e.text && <span className="text-slate-700"> · {shorten(e.text, 48)}</span>}
                  {e === hardest && (
                    <span className="ml-2 rounded-md bg-slate-900 px-2 py-0.5 text-sm font-semibold text-white">Más difícil</span>
                  )}
                </p>
                <p className="shrink-0 text-lg font-bold">{e.accuracy === null ? "—" : `${formatPercent(e.accuracy)} acierto`}</p>
              </div>
              {e.marked > 0 && (
                <>
                  {/* Stacked bar: one segment per status, 2px gaps between segments. */}
                  <div className="mt-1.5 flex h-4 gap-0.5" aria-hidden="true">
                    {STATUSES.filter((s) => e.counts[s.id] > 0).map((s) => (
                      <span
                        key={s.id}
                        title={`${e.label} · ${s.label}: ${e.counts[s.id]} de ${e.marked}`}
                        className={`h-full rounded-sm first:rounded-l-md last:rounded-r-md ${STATUS_FILL[s.id]}`}
                        style={{ width: `${(e.counts[s.id] / e.marked) * 100}%` }}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-base text-slate-700">
                    {STATUSES.filter((s) => e.counts[s.id] > 0)
                      .map((s) => `${e.counts[s.id]} ${s.label.toLowerCase()}`)
                      .join(" · ")}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ErrorChart({ assessments }: { assessments: Assessment[] }) {
  const counts = errorCounts(allMarks(assessments));
  const max = Math.max(1, ...counts.map((c) => c.count));

  return (
    <section aria-labelledby="error-chart-heading">
      <h3 id="error-chart-heading" className="text-2xl font-bold tracking-tight">
        Errores más frecuentes
      </h3>
      <p className="mt-1 text-base text-slate-700">En todos los prácticos corregidos del grupo.</p>
      {counts.length === 0 ? (
        <p className="mt-4 text-lg text-slate-700">Todavía no marcaste tipos de error.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {counts.map((c) => (
            <li key={c.id}>
              <div className="flex items-baseline justify-between gap-4 text-lg">
                <span>{errorLabel(c.id)}</span>
                <span className="font-bold">{c.count}</span>
              </div>
              <div className="mt-1.5 h-4 rounded-md bg-slate-100" aria-hidden="true">
                <div
                  className="h-full rounded-md bg-indigo-600"
                  title={`${errorLabel(c.id)}: ${c.count}`}
                  style={{ width: `${(c.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Empty({ group, data }: { group: Group; data: Data }) {
  const ready = data.assessments.filter((a) => a.groupId === group.id && a.versions.some((v) => v.approved));
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-400 px-6 py-8">
      <p className="text-xl font-semibold">Todavía no cargaste resultados de este grupo.</p>
      {ready.length === 0 ? (
        <p className="mt-2 text-lg text-slate-700">
          Primero creá un práctico y aprobá sus versiones. Después de corregirlo en papel, cargás cómo le fue a cada
          estudiante.
        </p>
      ) : (
        <>
          <p className="mt-2 text-lg text-slate-700">Después de corregir en papel, cargá cómo le fue a cada estudiante:</p>
          <ul className="mt-3 space-y-1 text-lg">
            {ready.map((a) => (
              <li key={a.id}>
                <Link href={gradeHref(group.id, a.id)} transitionTypes={FORWARD} className={inlineLink}>
                  Corregir {TYPE_LABEL[a.type].toLowerCase()}: {a.topic}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
