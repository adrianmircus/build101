"use client";

import Link from "next/link";
import { ErrorSummary, type FieldProblem } from "@/components/auth/staff/ErrorSummary";
import { StatusMessage } from "@/components/auth/staff/StatusMessage";
import { primaryButton, textLink } from "@/components/ui/styles";
import { FlowTop } from "./FlowTop";
import { ReviewTable, type ReviewLine } from "./ReviewTable";
import { UsernameInput } from "./UsernameInput";
import { createLabel, noteFor, problemText, problemsTitle, rowProblems, type DraftRow, type Flags } from "./usernameReview";

type Props = {
  groupName: string;
  institutionName: string;
  homeHref: string;
  rows: DraftRow[];
  flags: Flags;
  /** Some accounts were already created in this same screen: going back to the names would make them twice. */
  someCreated: boolean;
  pending: boolean;
  /** What stops the confirm, shown on top (`attempt` remounts it so it is announced again). */
  summary: { list: FieldProblem[]; attempt: number } | null;
  notice: { text: string; attempt: number } | null;
  onBack: () => void;
  onEdit: (key: string, value: string) => void;
  onConfirm: () => void;
};

export function CreateReview({ groupName, institutionName, homeHref, rows, flags, someCreated, pending, summary, notice, onBack, onEdit, onConfirm }: Props) {
  const problems = rowProblems(rows, flags);
  const lines: ReviewLine[] = rows.map((row) => {
    const problem = problems[row.key];
    const id = `usr-${row.key}`;
    const text = problem ? problemText(problem) : noteFor(row);
    return {
      key: row.key,
      first: row.displayName,
      second: <UsernameInput id={id} studentName={row.displayName} value={row.username} error={problem ? text ?? undefined : undefined} onChange={(value) => onEdit(row.key, value)} />,
      note: text ? { text, kind: problem ? "problem" : "info", id: problem ? `${id}-error` : undefined } : null,
    };
  });
  return (
    <div className="space-y-6">
      <FlowTop
        title="Revisá los usuarios"
        lead={`Así van a entrar en ${groupName}. El usuario es el nombre y la inicial del apellido, sin tildes. Podés cambiar el que quieras: no se crea nada hasta que confirmes.`}
        back={someCreated ? { label: institutionName, href: homeHref } : { label: "Volver a los nombres", onClick: onBack }}
        focus
      />
      {notice && (
        <StatusMessage key={notice.attempt} tone="neutral">
          <p>{notice.text}</p>
        </StatusMessage>
      )}
      {summary && summary.list.length > 0 && <ErrorSummary key={summary.attempt} title={problemsTitle(summary.list.length)} problems={summary.list} />}
      <ReviewTable caption={`Cuentas a crear en ${groupName}`} heads={["Estudiante", "Usuario"]} lines={lines} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <button type="button" onClick={onConfirm} disabled={pending} className={primaryButton}>
          {pending ? "Creando…" : createLabel(rows.length)}
        </button>
        <Link href={homeHref} className={textLink}>
          Cancelar
        </Link>
      </div>
    </div>
  );
}
