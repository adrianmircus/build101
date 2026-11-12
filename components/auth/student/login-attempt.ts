import { signOutAction } from "@/app/salir/actions";
import { callAction } from "@/lib/client/callAction";
import { rememberSchool } from "@/lib/client/remembered-school";
import type { LoginAction } from "./login-state";
import { beginLogin, type LoginTicket } from "./login-guard";
import { runLogin, type LoginOutcome } from "./login-flow";

type Attempt = {
  values: { code: string; username: string; password: string };
  knownName: () => Promise<string | null>;
  dispatch: (action: LoginAction) => void;
  go: (next: string) => void;
};

// Another card was opened while this login was in the air. If it signed in, that session is closed: nobody ends up inside as the old card's student.
async function discard(outcome: LoginOutcome): Promise<void> {
  if (outcome.kind === "in") await callAction(signOutAction, {});
}

async function finish(outcome: LoginOutcome, attempt: Attempt, ticket: LoginTicket): Promise<void> {
  const { dispatch } = attempt;
  if (outcome.kind === "pause") return dispatch({ type: "pause", retryAt: outcome.retryAt, at: Date.now() });
  if (outcome.kind === "notice") return dispatch({ type: "notice", notice: outcome.notice });
  const name = await attempt.knownName();
  // The new card can arrive in that wait too.
  if (ticket.stale) return discard(outcome);
  if (name) rememberSchool({ code: attempt.values.code, name });
  dispatch({ type: "wipe" });
  attempt.go(outcome.next);
}

/**
 * One login, from the click to where it ends. It is registered in the guard (login-guard.ts): if a new card comes meanwhile, the answer is
 * old and it does not navigate. A good one is closed with signOut; a bad one is dropped. The new card waits for this to be over.
 */
export async function attemptLogin(attempt: Attempt): Promise<void> {
  const ticket = beginLogin();
  try {
    const outcome = await runLogin(attempt.values);
    if (ticket.stale) return await discard(outcome);
    await finish(outcome, attempt, ticket);
  } finally {
    ticket.finish();
  }
}
