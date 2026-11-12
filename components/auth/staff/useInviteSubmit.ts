"use client";

import { useRef, useState } from "react";
import { callAction } from "@/lib/client/callAction";
import type { Accepted } from "@/lib/domain/accounts/results";
import type { Result } from "@/lib/errors";
import type { FieldProblem } from "./ErrorSummary";
import { inviteOutcome, type InviteContext } from "./invitationFailure";

export type InviteHandlers = {
  onAccepted: (accepted: Accepted) => void;
  onHaveAccount: () => void;
  onGone: () => void;
  onReload: () => void;
};

export type InviteNotice = { problems: FieldProblem[]; text: string | null; wrongPassword: boolean; attempt: number };

// The part every invitation form shares: one try at a time, the result turned into what the screen shows.
// `submit(call)` runs the action; on a failure it sets `notice` (it takes the focus) or hands over to the flow.
export function useInviteSubmit(context: InviteContext, handlers: InviteHandlers) {
  const [notice, setNotice] = useState<InviteNotice | null>(null);
  const [pending, setPending] = useState(false);
  const attempts = useRef(0);

  function show(partial: Partial<InviteNotice>) {
    attempts.current += 1;
    setNotice({ problems: [], text: null, wrongPassword: false, attempt: attempts.current, ...partial });
  }

  async function submit(call: () => Promise<Result<Accepted>>) {
    setPending(true);
    const result = await call();
    if (result.ok) return handlers.onAccepted(result.data);
    setPending(false);
    const outcome = inviteOutcome(result, context);
    if (outcome.kind === "problems") return show({ problems: outcome.problems });
    if (outcome.kind === "notice") return show({ text: outcome.text });
    if (outcome.kind === "wrong-password") return show({ wrongPassword: true });
    if (outcome.kind === "have-account") return handlers.onHaveAccount();
    if (outcome.kind === "gone") return handlers.onGone();
    handlers.onReload();
  }

  return { notice, pending, show, submit };
}

/** Wraps an action so a dropped connection or a stale build becomes a Failure (callAction), not a rejected promise. */
export function safely<I>(action: (input: I) => Promise<Result<Accepted>>, input: I): () => Promise<Result<Accepted>> {
  return () => callAction(action, input);
}
