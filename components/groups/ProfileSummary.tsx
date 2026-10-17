import { PROFILES } from "@/lib/profiles";
import type { Student } from "@/lib/groups/types";

// "TDAH · 3   Dislexia · 2": how many students in the group have each profile.
export function ProfileSummary({ students }: { students: Student[] }) {
  const counts = PROFILES.map((p) => ({
    ...p,
    count: students.filter((s) => s.profiles.includes(p.id)).length,
  })).filter((p) => p.count > 0);

  if (counts.length === 0) {
    return <p className="text-base text-slate-600">Nadie con adaptaciones cargadas</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Estudiantes por perfil">
      {counts.map((p) => (
        <li key={p.id} className="rounded-full bg-indigo-50 px-3 py-1 text-base font-medium text-indigo-900">
          {p.label} · {p.count}
        </li>
      ))}
    </ul>
  );
}
