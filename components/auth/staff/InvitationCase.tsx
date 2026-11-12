"use client";

import type { Accepted, InvitationPublic, NextStep } from "@/lib/domain/accounts/results";
import type { ActionFn } from "./actionFn";
import { InvitationAction } from "./InvitationAction";
import { InvitationLetter } from "./InvitationLetter";
import { caseOf } from "./whichCase";
import { inviteTitle, roleLabel } from "./invitationText";
import { InviteAccept } from "./InviteAccept";
import { InviteExpired } from "./InviteExpired";
import { InviteNewAccount } from "./InviteNewAccount";
import { InviteOtherEmail } from "./InviteOtherEmail";
import { InviteSignIn } from "./InviteSignIn";
import { formatDay } from "./retryTime";
import type { InviteHandlers } from "./useInviteSubmit";

export type InvitationActions = {
  accept: ActionFn<{ token: string }, Accepted>;
  acceptAsNew: ActionFn<{ token: string; displayName: string; password: string }, Accepted>;
  signInAndAccept: ActionFn<{ token: string; password: string }, Accepted>;
  signOut: ActionFn<Record<string, never>, NextStep>;
};

type Props = InviteHandlers & {
  invitation: InvitationPublic;
  token: string;
  actions: InvitationActions;
  wantsSignIn: boolean;
  onSignIn: () => void;
};

// The letter and the one action of the invitation, by case (see invitationCase.ts).
export function InvitationCase({ invitation, token, actions, wantsSignIn, onSignIn, ...handlers }: Props) {
  const title = inviteTitle(invitation);
  const shared = { invitation, token, ...handlers };
  switch (caseOf(invitation, wantsSignIn)) {
    case "expired":
      return <InviteExpired status={invitation.status} inviterName={invitation.inviterName} institutionName={invitation.institutionName} />;
    case "other":
      return <InviteOtherEmail invitation={invitation} signOut={actions.signOut} onSignedOut={handlers.onReload} />;
    case "accept":
      return (
        <>
          <InvitationLetter title={title}>
            <p>Vas a entrar como {roleLabel(invitation.role)}. Tus grupos de otros colegios siguen separados: cada colegio ve solo lo suyo.</p>
          </InvitationLetter>
          <InvitationAction>
            <InviteAccept {...shared} accept={actions.accept} />
          </InvitationAction>
        </>
      );
    case "signin":
      return (
        <>
          <InvitationLetter title={title}>
            <p>Ya tenés cuenta en Tiza.ai. Entrá y la invitación se acepta sola.</p>
          </InvitationLetter>
          <InvitationAction title="Entrá para aceptar">
            <InviteSignIn {...shared} signInAndAccept={actions.signInAndAccept} />
          </InvitationAction>
        </>
      );
    case "new":
      return (
        <>
          <InvitationLetter title={title}>
            <p>
              Vas a entrar como {roleLabel(invitation.role)}. La invitación es para <strong>{invitation.email}</strong> y vence el {formatDay(invitation.expiresAt)}.
            </p>
          </InvitationLetter>
          <InvitationAction title="Creá tu cuenta">
            <InviteNewAccount {...shared} acceptAsNew={actions.acceptAsNew} onSignIn={onSignIn} />
          </InvitationAction>
        </>
      );
  }
}
