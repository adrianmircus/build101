import Link from "next/link";
import { inlineLink, typeTag } from "@/components/ui/styles";
import { FORWARD } from "@/components/ui/transitions";
import type { Assessment } from "@/lib/groups/types";
import { TYPE_LABEL } from "@/lib/groups/versions";

export function AssessmentList({ groupId, assessments }: { groupId: string; assessments: Assessment[] }) {
  if (assessments.length === 0) {
    return (
      <p className="rounded-2xl border-2 border-dashed border-slate-400 px-6 py-8 text-lg text-slate-700">
        Todavía no hay prácticos ni parciales para este grupo.{" "}
        <Link href={`/grupos/${groupId}/evaluaciones/nueva`} transitionTypes={FORWARD} className={inlineLink}>
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
              href={`/grupos/${groupId}/evaluaciones/${a.id}`}
              transitionTypes={FORWARD}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 transition-colors hover:border-indigo-700 hover:bg-indigo-50/40 sm:px-6"
            >
              <span className="flex flex-wrap items-center gap-3">
                <span className={typeTag}>
                  {TYPE_LABEL[a.type]}
                </span>
                <span className="text-lg font-semibold">{a.topic}</span>
                <span className="text-base text-slate-700">
                  {new Date(a.createdAt).toLocaleDateString("es-UY", { day: "numeric", month: "long" })}
                </span>
              </span>
              <span className={`text-base font-semibold ${approved === a.versions.length ? "text-emerald-800" : "text-amber-900"}`}>
                {approved === a.versions.length && "✓ "}
                {approved} de {a.versions.length} versiones aprobadas
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
