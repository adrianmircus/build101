import Link from "next/link";
import { textLink } from "@/components/ui/styles";
import type { InstitutionSummary } from "@/lib/domain/accounts/entities";
import { summaryTexts } from "./summaryText";

// What there is in the school, in two short sentences, each with its list.
export function SummaryBlock({ summary }: { summary: InstitutionSummary }) {
  const base = `/institucion/${summary.id}`;
  const texts = summaryTexts(summary);
  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <section aria-labelledby="resumen-profes" className="space-y-1">
        <h2 id="resumen-profes" className="text-2xl font-bold">
          Profes
        </h2>
        <p className="text-lg text-slate-800">{texts.staff}</p>
        <Link href={`${base}/profes`} className={textLink}>
          Ver profes e invitaciones
        </Link>
      </section>
      <section aria-labelledby="resumen-estudiantes" className="space-y-1">
        <h2 id="resumen-estudiantes" className="text-2xl font-bold">
          Estudiantes
        </h2>
        <p className="text-lg text-slate-800">{texts.students}</p>
        <Link href={`${base}/grupos`} className={textLink}>
          Ver grupos
        </Link>
      </section>
    </div>
  );
}
