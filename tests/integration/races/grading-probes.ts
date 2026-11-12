import { openSession } from "../support/db";
import { waitUntilBlocked, type Step } from "../support/race";
import { describeOutcome, type Outcome, type Session } from "../support/session";
import type { Student } from "./attempts-support";

// The probes of the lock order of grading (grading-locks.test.ts), the pattern of attempts-locks.test.ts: a connection holds ONLY one
// row (the assignment, the attempt, the draft or the grade), the RPC starts on another connection and waits on it, and a third
// connection tries the other rows with NOWAIT. If the RPC had taken a row before its parent, NOWAIT fails with 55P03 on a row that
// has to be free; if it did not take the parent first, a row that has to be locked is free. Placeholder text only.

function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "error";
}

/** "free", or the SQLSTATE the NOWAIT failed with (55P03: locked by someone else). A failure aborts the transaction: a fresh one starts. */
export async function nowait(prober: Session, sql: string, id: string): Promise<string> {
  try {
    await prober.rows(sql, [id]);
    return "free";
  } catch (thrown) {
    await prober.rollback();
    await prober.beginAsOwner();
    return codeOf(thrown);
  }
}

export const ASSIGNMENT_ROW = "select id from app.assignments where id = $1 for update nowait";
export const ATTEMPT_ROW = "select id from app.assignment_attempts where id = $1 for update nowait";
export const DRAFT_ROW = "select id from app.submissions where attempt_id = $1 for update nowait";
export const GRADE_ROW = "select id from app.grades where attempt_id = $1 for update nowait";

export type Held = { waitedOn: string | null; result: string; states: Record<string, string> };

/** The step waits behind `hold`; `probe` looks at the locks it already took, from a third connection. */
export async function whileWaiting(
  step: Step,
  hold: (holder: Session) => Promise<void>,
  probe: (prober: Session) => Promise<Record<string, string>>,
): Promise<Held> {
  const [holder, caller, observer, prober] = await Promise.all([openSession(), openSession(), openSession(), openSession()]);
  try {
    await holder.beginAsOwner();
    await hold(holder);
    await caller.begin(step.actor);
    let done = false;
    const pending = caller.call(step.rpc, step.args).finally(() => {
      done = true;
    });
    const waitedOn = await waitUntilBlocked(caller, observer, () => done);
    await prober.beginAsOwner();
    const states = await probe(prober);
    await prober.rollback();
    await holder.rollback();
    const outcome: Outcome = await pending;
    if (outcome.ok) await caller.commit();
    else await caller.rollback();
    return { waitedOn, result: describeOutcome(outcome), states };
  } finally {
    await Promise.all([holder.close(), caller.close(), observer.close(), prober.close()]);
  }
}

export const holdAssignment = (s: Student) => async (holder: Session) => {
  await holder.rows("select id from app.assignments where id = $1 for update", [s.assignmentId]);
};
export const holdAttempt = (s: Student) => async (holder: Session) => {
  await holder.rows("select id from app.assignment_attempts where id = $1 for update", [s.attemptId]);
};
export const holdDraft = (s: Student) => async (holder: Session) => {
  await holder.rows("select id from app.submissions where attempt_id = $1 for update", [s.attemptId]);
};
export const holdGrade = (s: Student) => async (holder: Session) => {
  await holder.rows("select id from app.grades where attempt_id = $1 for update", [s.attemptId]);
};
