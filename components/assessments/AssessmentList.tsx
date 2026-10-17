import Link from "next/link";
import type { Assessment } from "@/lib/groups/types";
import { TYPE_LABEL } from "@/lib/groups/versions";

export function AssessmentList({ groupId, assessments }: { groupId: string; assessments: Assessment[] }) {
  if (assessments.length === 0) {
    return (
      <p className="text-lg text-slate-700">
        Todavía no hay prácticos ni parciales para este grupo.{" "}
        <Link href={`/groups/${groupId}/assessments/new`} className="font-semibold text-indigo-800 underline">
          Crear el primero
        </Link>
      </p>
    );
  }
  const sorted = [...assessments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <ul className="space-y-3">
      {sorted.map((a) => {
        const approved = a.versions.filter((v) => v.approved).length;
        return (
          <li key={a.id}>
            <Link
              href={`/groups/${groupId}/assessments/${a.id}`}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-slate-200 bg-white px-6 py-4 hover:border-indigo-700"
            >
              <span className="flex flex-wrap items-center gap-3">
                <span className="rounded-md bg-slate-900 px-2 py-0.5 text-sm font-bold uppercase tracking-wide text-white">
                  {TYPE_LABEL[a.type]}
                </span>
                <span className="text-lg font-semibold">{a.topic}</span>
                <span className="text-base text-slate-600">
                  {new Date(a.createdAt).toLocaleDateString("es-UY", { day: "numeric", month: "long" })}
                </span>
              </span>
              <span className={`text-base font-medium ${approved === a.versions.length ? "text-emerald-800" : "text-slate-700"}`}>
                {approved} de {a.versions.length} versiones aprobadas
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
