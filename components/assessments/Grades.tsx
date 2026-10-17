"use client";

import Link from "next/link";
import { useState } from "react";
import { field, textLink } from "@/components/ui/styles";
import { FORWARD } from "@/components/ui/transitions";
import { GRADE_MAX, GRADE_MIN, parseScore } from "@/lib/groups/grades";
import { setGrade } from "@/lib/groups/store";
import type { Assessment, Grade, Group, Student, Version } from "@/lib/groups/types";
import { versionLabel } from "@/lib/groups/versions";

// The teacher grades each student of the assessment. Students see a grade as soon as it's saved,
// once their version is approved.
export function Grades({ assessment, group }: { assessment: Assessment; group: Group }) {
  const rows = group.students
    .map((student) => ({ student, version: assessment.versions.find((v) => v.studentIds.includes(student.id)) }))
    .filter((row): row is { student: Student; version: Version } => row.version !== undefined);
  const graded = rows.filter(({ student }) => assessment.grades?.[student.id]).length;

  return (
    <section aria-labelledby="grades-heading" className="mt-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="grades-heading" className="text-3xl font-bold tracking-tight">
          Calificaciones
        </h2>
        <p className="text-lg text-slate-700">
          {graded} de {rows.length} calificados · notas del {GRADE_MIN} al {GRADE_MAX}
        </p>
        {rows.length > 0 && (
          <Link
            href={`/grupos/${group.id}/evaluaciones/${assessment.id}/corregir`}
            transitionTypes={FORWARD}
            className={`${textLink} text-lg font-semibold`}
          >
            Corregir por ejercicio →
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-lg text-slate-700">Ningún estudiante del grupo tiene este práctico.</p>
      ) : (
        <ul className="divide-y-2 divide-slate-100 rounded-2xl border-2 border-slate-200 bg-white">
          {rows.map(({ student, version }) => (
            <GradeRow
              key={student.id}
              assessmentId={assessment.id}
              student={student}
              version={version}
              grade={assessment.grades?.[student.id]}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GradeRow({
  assessmentId,
  student,
  version,
  grade,
}: {
  assessmentId: string;
  student: Student;
  version: Version;
  grade?: Grade;
}) {
  // The typed text lives here so an out-of-range value can be shown and fixed without being saved.
  const [text, setText] = useState(grade ? String(grade.score) : "");
  const invalid = text.trim() !== "" && parseScore(text) === null;
  const id = `grade-${student.id}`;

  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-4 sm:grid-cols-[minmax(10rem,1fr)_7rem_2fr] sm:items-start sm:px-6">
      <div>
        <p className="text-lg font-semibold">{student.name}</p>
        <p className="text-base text-slate-700">Versión {versionLabel(version.profiles, version.supports)}</p>
        {!version.approved && (
          <p className="text-base font-semibold text-amber-900">Todavía no ve este práctico: aprobá su versión.</p>
        )}
      </div>
      <div>
        <label htmlFor={`${id}-score`} className="sr-only">
          Nota de {student.name}, del {GRADE_MIN} al {GRADE_MAX}
        </label>
        <input
          id={`${id}-score`}
          type="number"
          inputMode="numeric"
          min={GRADE_MIN}
          max={GRADE_MAX}
          step={1}
          placeholder="Nota"
          className={`${field} text-center text-xl font-bold`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim() === "") {
              setGrade(assessmentId, student.id, null);
              return;
            }
            const score = parseScore(e.target.value);
            if (score !== null) {
              setGrade(assessmentId, student.id, { ...grade, score, gradedAt: new Date().toISOString() });
            }
          }}
        />
      </div>
      <div>
        <label htmlFor={`${id}-feedback`} className="sr-only">
          Devolución para {student.name} (opcional)
        </label>
        <input
          id={`${id}-feedback`}
          className={field}
          placeholder={grade ? "Devolución (opcional)" : "Poné la nota para agregar una devolución"}
          disabled={!grade}
          value={grade?.feedback ?? ""}
          onChange={(e) => grade && setGrade(assessmentId, student.id, { ...grade, feedback: e.target.value })}
        />
      </div>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-base font-semibold text-red-800 sm:col-span-3">
          Tiene que ser un número entero del {GRADE_MIN} al {GRADE_MAX}.
        </p>
      )}
    </li>
  );
}
