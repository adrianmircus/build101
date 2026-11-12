import type { StaffRow } from "@/lib/domain/accounts/entities";
import { staffLine } from "./listText";

type Props = { rows: StaffRow[]; youId: string };

// Who is in the school and whether they have entered. It only reads: changing someone's role is not built in this phase.
export function StaffList({ rows, youId }: Props) {
  return (
    <section aria-labelledby="en-el-colegio" className="space-y-3">
      <h2 id="en-el-colegio" className="text-2xl font-bold">
        En el colegio
      </h2>
      {rows.length === 0 ? (
        <p className="text-lg text-slate-700">Todavía no hay profes en el colegio.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.userId} className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
              <p className="text-lg font-semibold [overflow-wrap:anywhere]">{row.displayName ?? row.email}</p>
              <p className="text-base text-slate-700 [overflow-wrap:anywhere]">
                {staffLine(row, row.userId === youId)}
                {row.displayName ? ` · ${row.email}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
