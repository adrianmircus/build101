"use client";

import Link from "next/link";
import { roleLabel } from "@/components/auth/staff/invitationText";
import { StatusMessage } from "@/components/auth/staff/StatusMessage";
import { inlineLink, primaryButton, textLink } from "@/components/ui/styles";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import { FlowTop } from "./FlowTop";
import { canFix, reasonText, type ReviewRow } from "./inviteVerdicts";
import { sendLabel } from "./inviteFlowState";
import { ReviewTable, type ReviewLine } from "./ReviewTable";

type Props = {
  rows: ReviewRow[];
  role: InvitedRole;
  homeHref: string;
  pending: boolean;
  /** A failed send: neutral text, and `attempt` remounts it so it is announced and takes the focus. */
  notice: { text: string; attempt: number } | null;
  onBack: () => void;
  onConfirm: () => void;
};

// The key has the position: the same email can be in the list twice (that is one of the cases the review shows).
function lineFor({ row, index, role, onBack }: { row: ReviewRow; index: number; role: InvitedRole; onBack: () => void }): ReviewLine {
  const key = `${index}-${row.email}`;
  const reason = reasonText(row.verdict);
  if (!reason) return { key, first: row.email, second: `Se invita como ${roleLabel(role)}` };
  return {
    key,
    first: row.email,
    second: <strong className="font-semibold">No se manda</strong>,
    note: { text: reason, kind: canFix(row.verdict) ? "problem" : "info" },
    action: canFix(row.verdict) ? (
      <button type="button" onClick={onBack} className={`${inlineLink} mt-1`}>
        Corregir<span className="sr-only"> {row.email}</span>
      </button>
    ) : null,
  };
}

export function InviteReview({ rows, role, homeHref, pending, notice, onBack, onConfirm }: Props) {
  const count = rows.filter((row) => row.verdict.kind === "send").length;
  return (
    <div className="space-y-6">
      <FlowTop
        title="Revisá antes de mandar"
        lead={`Van a entrar como ${roleLabel(role)}. Lo que no se manda queda marcado con el motivo.`}
        back={{ label: "Volver a los correos", onClick: onBack }}
        focus
      />
      {notice && (
        <StatusMessage key={notice.attempt} tone="neutral">
          <p>{notice.text}</p>
        </StatusMessage>
      )}
      <ReviewTable caption="Correos a invitar" heads={["Correo", "Qué pasa"]} lines={rows.map((row, index) => lineFor({ row, index, role, onBack }))} />
      {count === 0 && <p className="text-lg text-slate-800">No hay ningún correo para mandar. Volvé a los correos y corregilos.</p>}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <button type="button" onClick={onConfirm} disabled={count === 0 || pending} className={primaryButton}>
          {pending ? "Mandando…" : sendLabel(count)}
        </button>
        <Link href={homeHref} className={textLink}>
          Cancelar
        </Link>
      </div>
    </div>
  );
}
