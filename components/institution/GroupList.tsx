import Link from "next/link";
import { textLink } from "@/components/ui/styles";
import type { GroupSummary } from "@/lib/domain/groups/rpc";
import { countText } from "./listText";
import { subjectName } from "./subjectNames";

type Props = { institutionId: string; groups: GroupSummary[] };

// The groups of the school, each with the way to its cards. The groups themselves are worked in /grupos.
export function GroupList({ institutionId, groups }: Props) {
  const open = groups.filter((group) => group.archivedAt === null);
  if (open.length === 0) return <p className="text-lg text-slate-700">Todavía no hay grupos. Se crean al crear cuentas de estudiantes.</p>;
  return (
    <ul className="space-y-3">
      {open.map((group) => (
        <li key={group.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <div className="min-w-0">
            <p className="text-lg font-semibold [overflow-wrap:anywhere]">{group.name}</p>
            <p className="text-base text-slate-700">
              {subjectName(group.subjectId)} {group.schoolYear} · {group.studentCount === 0 ? "sin estudiantes todavía" : countText(group.studentCount, "estudiante", "estudiantes")}
            </p>
          </div>
          <Link href={`/institucion/${institutionId}/grupos/${group.id}/tarjetas`} className={textLink}>
            Tarjetas<span className="sr-only"> de {group.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
