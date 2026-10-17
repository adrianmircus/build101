"use client";

import { Loading } from "@/components/ui/States";
import { typeTag } from "@/components/ui/styles";
import { assignedTo, formatAverage, GRADE_MAX } from "@/lib/groups/grades";
import { useData } from "@/lib/groups/store";
import { TYPE_LABEL } from "@/lib/groups/versions";

// The student's own grades on what they were assigned. Like MyAssignments, it shows no profiles or versions.
export function MyGrades({ studentId, groupId }: { studentId: string; groupId: string }) {
  const data = useData();
  if (!data) return <Loading />;

  const assigned = assignedTo(data, studentId, groupId);
  const graded = assigned.flatMap((a) => {
    const grade = a.grades?.[studentId];
    return grade ? [{ assessment: a, grade }] : [];
  });
  const pending = assigned.filter((a) => !a.grades?.[studentId]);

  if (graded.length === 0) {
    return (
      <p className="rounded-2xl border-2 border-dashed border-slate-400 px-6 py-8 text-lg text-slate-700">
        Todavía no tenés calificaciones. Cuando tu profesor corrija un práctico o parcial, la nota aparece acá.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xl">
        <span className="font-bold">Promedio: {formatAverage(graded.map((g) => g.grade.score))}</span>
        <span className="text-slate-700">
          {" "}
          · {graded.length} {graded.length === 1 ? "calificación" : "calificaciones"}
        </span>
      </p>
      <ul className="space-y-3">
        {graded.map(({ assessment, grade }) => (
          <li
            key={assessment.id}
            className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 sm:px-6"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={typeTag}>{TYPE_LABEL[assessment.type]}</span>
              <span className="text-lg font-semibold">{assessment.topic}</span>
              <span className="text-base text-slate-700">
                {new Date(assessment.createdAt).toLocaleDateString("es-UY", { day: "numeric", month: "long" })}
              </span>
            </div>
            <p className="row-span-2 text-right whitespace-nowrap">
              <span className="text-4xl font-bold tabular-nums">{grade.score}</span>
              <span className="text-lg text-slate-700"> / {GRADE_MAX}</span>
            </p>
            {grade.feedback?.trim() && <p className="text-lg text-slate-800">{grade.feedback}</p>}
          </li>
        ))}
      </ul>
      {pending.length > 0 && (
        <p className="text-lg text-slate-700">
          Sin calificar todavía: {pending.map((a) => `${TYPE_LABEL[a.type]} de ${a.topic}`).join(", ")}.
        </p>
      )}
    </div>
  );
}
