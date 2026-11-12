"use client";

import { useReducer, useRef, useState } from "react";
import { failureText } from "@/components/auth/staff/failureText";
import type { ActionFn } from "@/components/auth/staff/actionFn";
import { callAction } from "@/lib/client/callAction";
import type { InvitationView, StaffRow } from "@/lib/domain/accounts/entities";
import type { InviteStaffInput } from "@/lib/domain/accounts/inputs";
import type { InviteRowResult } from "@/lib/domain/accounts/results";
import type { z } from "zod";
import { inviteReducer, initialInvite, pasteProblem, pasteProblemText } from "./inviteFlowState";
import { emailsToSend, reviewInvites } from "./inviteVerdicts";
import { attemptFor } from "./opKey";

export type InviteAction = ActionFn<z.input<typeof InviteStaffInput>, InviteRowResult[]>;

type Options = { institutionId: string; members: StaffRow[]; invitations: InvitationView[]; invite: InviteAction };
type Message = { message: string; attempt: number };

// The logic of «Invitar profes»: what each step does, and what the screen says when something does not work.
export function useInviteFlow({ institutionId, members, invitations, invite }: Options) {
  const [state, dispatch] = useReducer(inviteReducer, undefined, initialInvite);
  const [problem, setProblem] = useState<Message | null>(null);
  const [notice, setNotice] = useState<{ text: string; attempt: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [visited, setVisited] = useState(false);
  const counter = useRef(0);

  function review() {
    const found = pasteProblem(state.text);
    if (found) return setProblem({ message: pasteProblemText(found), attempt: ++counter.current });
    setProblem(null);
    setNotice(null);
    setVisited(true);
    dispatch({ type: "reviewing", rows: reviewInvites(state.text, { role: state.role, members, invitations }) });
  }

  async function confirm() {
    const emails = emailsToSend(state.rows);
    if (emails.length === 0) return;
    const attempt = attemptFor(state.attempt, JSON.stringify([emails, state.role]), () => crypto.randomUUID());
    dispatch({ type: "attempt", attempt });
    setPending(true);
    const result = await callAction(invite, { institutionId, emails, role: state.role, opKey: attempt.opKey });
    setPending(false);
    if (!result.ok) return setNotice({ text: failureText(result), attempt: ++counter.current });
    setNotice(null);
    dispatch({ type: "sent", results: result.data });
  }

  return { state, dispatch, problem, notice, pending, visited, review, confirm };
}
