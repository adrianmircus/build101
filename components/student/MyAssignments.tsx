"use client";

import { Loading } from "@/components/ui/States";
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
    return <p className="text-lg text-slate-700">Todavía no tenés prácticos ni parciales. Cuando tu profesor publique uno, aparece acá.</p>;
  }
  return (
    <ul className="space-y-3">
      {assigned.map((a) => (
        <li
          key={a.id}
          className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white px-6 py-4"
        >
          <span className="rounded-md bg-slate-900 px-2 py-0.5 text-sm font-bold uppercase tracking-wide text-white">
            {TYPE_LABEL[a.type]}
          </span>
          <span className="text-lg font-semibold">{a.topic}</span>
          <span className="text-base text-slate-600">
            {new Date(a.createdAt).toLocaleDateString("es-UY", { day: "numeric", month: "long" })}
          </span>
        </li>
      ))}
    </ul>
  );
}
