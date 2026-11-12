"use client";

import Link from "next/link";
import type { InvitationPublic, NextStep } from "@/lib/domain/accounts/results";
import { primaryButton, textLink } from "@/components/ui/styles";
import type { ActionFn } from "./actionFn";
import { EmailClash } from "./EmailClash";
import { InvitationAction } from "./InvitationAction";
import { InvitationLetter } from "./InvitationLetter";
import { SignOutButton } from "./SignOutButton";
import { StatusMessage } from "./StatusMessage";

type Props = { invitation: InvitationPublic; signOut: ActionFn<Record<string, never>, NextStep>; onSignedOut: () => void };

// Case «con sesión y otro correo» (invitacion-a, #otro-correo, with the mark of B). It does not accept: it explains.
// The page does not know the email of the open session (the server only says it is another one), so it does not name it.
export function InviteOtherEmail({ invitation, signOut, onSignedOut }: Props) {
  const inviter = invitation.inviterName ?? "quien te invitó";
  return (
    <>
      <InvitationLetter title="Esta invitación es para otro correo">
        <p>La invitación a {invitation.institutionName} es para este correo:</p>
        <EmailClash email={invitation.email} />
      </InvitationLetter>
      <InvitationAction>
        <StatusMessage tone="neutral">
          <p>
            Para aceptarla, salí y entrá con <strong>{invitation.email}</strong>. Si preferís usar el correo con el que entraste ahora, pedile a {inviter} que te invite a
            ese.
          </p>
        </StatusMessage>
        <div className="flex flex-col items-start gap-3">
          <SignOutButton label={`Salir y entrar con ${invitation.email}`} className={`${primaryButton} max-w-full text-left [overflow-wrap:anywhere]`} signOut={signOut} onSignedOut={onSignedOut} />
          <Link href="/grupos" className={textLink}>
            Seguir con mi sesión
          </Link>
        </div>
      </InvitationAction>
    </>
  );
}
