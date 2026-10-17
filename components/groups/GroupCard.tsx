import Link from "next/link";
import { card } from "@/components/ui/styles";
import { FORWARD } from "@/components/ui/transitions";
import type { Assessment, Group } from "@/lib/groups/types";
import { groupByProfiles, TYPE_LABEL } from "@/lib/groups/versions";
import { ProfileSummary } from "./ProfileSummary";

export function GroupCard({ group, latest }: { group: Group; latest?: Assessment }) {
  const versions = groupByProfiles(group.students).length;
  return (
    <Link
      href={`/grupos/${group.id}`}
      transitionTypes={FORWARD}
      className={`${card} flex h-full flex-col gap-4 transition-colors hover:border-indigo-700 hover:bg-indigo-50/40`}
    >
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{group.name}</h2>
        <p className="text-lg text-slate-700">
          {group.students.length} {group.students.length === 1 ? "estudiante" : "estudiantes"}
          {versions > 1 && ` · ${versions} versiones por práctico`}
        </p>
      </div>
      <ProfileSummary students={group.students} />
      <p className="mt-auto border-t-2 border-slate-100 pt-3 text-base text-slate-700">
        {latest ? `Último: ${TYPE_LABEL[latest.type]} · ${latest.topic}` : "Sin prácticos todavía"}
      </p>
    </Link>
  );
}
