"use client";

import { useEffect, useState } from "react";
import type { InvitationPublic } from "@/lib/domain/accounts/results";
import type { ActionFn } from "./actionFn";
import { onFragmentChange, takeFragmentToken } from "./fragmentToken";
import type { InvitationActions } from "./InvitationCase";
import { InvitationPage } from "./InvitationPage";
import { InvitationScreen } from "./InvitationScreen";
import { invitationPhaseFor, type Phase } from "./invitationPhase";

type Props = { read: ActionFn<{ token: string }, InvitationPublic>; actions: InvitationActions };

// /invitacion#<token>: reads the token from the fragment, clears the bar and keeps it only in memory for the next
// actions (the server never sees it in a URL). Then shows the case that corresponds (whichCase.ts).
export function InvitationFlow({ read, actions }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [token, setToken] = useState("");
  const [round, setRound] = useState(0);
  const [wantsSignIn, setWantsSignIn] = useState(false);

  useEffect(() => {
    let current = true;
    const held = takeFragmentToken();
    invitationPhaseFor(read, held).then((next) => {
      if (!current) return;
      setToken(held);
      setPhase(next);
    });
    return () => {
      current = false;
    };
  }, [read, round]);

  function reload() {
    setPhase({ kind: "loading" });
    setRound((n) => n + 1);
  }

  useEffect(() => onFragmentChange(reload), []);

  return (
    <InvitationPage>
      <InvitationScreen phase={phase} token={token} actions={actions} wantsSignIn={wantsSignIn} setWantsSignIn={setWantsSignIn} reload={reload} setPhase={setPhase} />
    </InvitationPage>
  );
}
