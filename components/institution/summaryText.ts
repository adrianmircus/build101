import type { InstitutionSummary } from "@/lib/domain/accounts/entities";
import { countText } from "./listText";

// The two sentences of the summary of the school. get_institution_summary gives counts only, nothing about a person.

export function summaryTexts(summary: Pick<InstitutionSummary, "staffCount" | "pendingInvitations" | "groupCount" | "studentCount">): { staff: string; students: string } {
  const waiting =
    summary.pendingInvitations === 0
      ? "Ninguna invitación esperando respuesta."
      : `${countText(summary.pendingInvitations, "invitación esperando", "invitaciones esperando")} respuesta.`;
  const inSchool = summary.staffCount === 1 ? "1 en el colegio." : `${summary.staffCount} en el colegio.`;
  const students =
    summary.studentCount === 0
      ? "Todavía no hay cuentas de estudiantes."
      : `${countText(summary.studentCount, "cuenta", "cuentas")} en ${countText(summary.groupCount, "grupo", "grupos")}.`;
  return { staff: `${inSchool} ${waiting}`, students };
}
