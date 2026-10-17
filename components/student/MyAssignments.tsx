"use client";

import { Loading } from "@/components/ui/States";
import { typeTag } from "@/components/ui/styles";
import { useData } from "@/lib/groups/store";
import { TYPE_LABEL } from "@/lib/groups/versions";

// Only lists what the teacher already approved. Shows no profiles or version labels:
// the student doesn't need to know their assessment is adapted.
export function MyAssignments({ studentId, groupId }: { studentId: string; groupId: string }) {
  const data = useData();
  if (!data) return <Loading />;

  const assigned = data.assessments
    .filter((a) => a.groupId === groupId)
    .filter((a) => a.versions.some((v) => v.approved && v.studentIds.includes(studentId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (assigned.length === 0) {
    return (
      <p className="rounded-2xl border-2 border-dashed border-slate-400 px-6 py-8 text-lg text-slate-700">
        Todavía no tenés prácticos ni parciales. Cuando tu profesor publique uno, aparece acá.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {assigned.map((a) => (
        <li
          key={a.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 sm:px-6"
        >
          <span className={typeTag}>
            {TYPE_LABEL[a.type]}
          </span>
          <span className="text-lg font-semibold">{a.topic}</span>
          <span className="text-base text-slate-700">
            {new Date(a.createdAt).toLocaleDateString("es-UY", { day: "numeric", month: "long" })}
          </span>
        </li>
      ))}
    </ul>
  );
}
