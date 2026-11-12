"use client";

import { InvitationCase, type InvitationActions } from "./InvitationCase";
import { InviteDone } from "./InviteDone";
import { InviteExpired } from "./InviteExpired";
import { InviteMessage } from "./InviteMessage";
import type { Phase } from "./invitationPhase";

type Props = {
  phase: Phase;
  token: string;
  actions: InvitationActions;
  wantsSignIn: boolean;
  setWantsSignIn: (value: boolean) => void;
  reload: () => void;
  setPhase: (phase: Phase) => void;
};

export function InvitationScreen({ phase, token, actions, wantsSignIn, setWantsSignIn, reload, setPhase }: Props) {
  if (phase.kind === "loading" || phase.kind === "missing") return <InviteMessage kind={phase.kind} />;
  if (phase.kind === "error") return <InviteMessage kind="error" text={phase.text} onRetry={reload} />;
  if (phase.kind === "gone") return <InviteExpired />;
  if (phase.kind === "done") return <InviteDone institutionName={phase.institutionName} accepted={phase.accepted} />;
  const { invitation } = phase;
  return (
    <InvitationCase
      invitation={invitation}
      token={token}
      actions={actions}
      wantsSignIn={wantsSignIn}
      onSignIn={() => setWantsSignIn(true)}
      onAccepted={(accepted) => setPhase({ kind: "done", institutionName: invitation.institutionName, accepted })}
      onHaveAccount={() => setWantsSignIn(true)}
      onGone={() => setPhase({ kind: "gone" })}
      onReload={reload}
    />
  );
}
