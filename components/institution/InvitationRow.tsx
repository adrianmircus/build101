"use client";

import { StatusMessage } from "@/components/auth/staff/StatusMessage";
import { dangerButton, textLink } from "@/components/ui/styles";
import type { InvitationView } from "@/lib/domain/accounts/entities";
import { Icon } from "./Icon";
import { invitationLine, mailPending } from "./listText";
import { RevokeConfirm } from "./RevokeConfirm";
import { useInvitationRow, type InvitationActions } from "./useInvitationRow";

type Props = { institutionId: string; item: InvitationView; actions: InvitationActions };

// One invitation waiting for an answer: who, the role, when it expires, and what can be done. Revoking asks first.
export function InvitationRow({ institutionId, item, actions }: Props) {
  const row = useInvitationRow(institutionId, item, actions);
  const busy = row.phase === "busy";
  return (
    <li className="space-y-2 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold [overflow-wrap:anywhere]">{item.email}</p>
          <p className="text-base text-slate-700">{invitationLine(item)}</p>
          {mailPending(item) && (
            <p className="mt-1 flex gap-2 text-base text-slate-900">
              <Icon name="idea" className="mt-0.5 size-5" />
              Todavía no salió el correo. Probá reenviar.
            </p>
          )}
        </div>
        {row.phase !== "confirming" && (
          <div className="flex flex-wrap items-center gap-x-2">
            <button type="button" onClick={row.resend} disabled={busy} className={textLink}>
              {busy ? "Un momento…" : item.status === "expired" ? "Mandar otra" : "Reenviar"}
              <span className="sr-only"> a {item.email}</span>
            </button>
            <button type="button" onClick={row.ask} disabled={busy} className={dangerButton}>
              Revocar<span className="sr-only"> la invitación de {item.email}</span>
            </button>
          </div>
        )}
      </div>
      {row.phase === "confirming" && <RevokeConfirm email={item.email} onRevoke={row.revoke} onCancel={row.cancel} />}
      {row.message && (
        <StatusMessage key={row.message.attempt} tone="neutral">
          <p>{row.message.text}</p>
        </StatusMessage>
      )}
    </li>
  );
}
