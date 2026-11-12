import { describe, expect, it } from "vitest";
import { openSession } from "../support/db";
import { waitUntilBlocked, type Step } from "../support/race";
import { describeOutcome, type Outcome, type Session } from "../support/session";
import { openStep, published, saveStep, startStep, startedWithDraft, submitStep, type Published, type Student } from "./attempts-support";

// The lock order of the attempt RPCs (T1.5b): app.lock_attempt_tree takes the assignment, then the attempt, then the draft,
// and publish_version takes an assignment before its attempts, so the two cannot cross. Each probe is deterministic and does
// not depend on which row the two calls fight for: a connection holds ONLY one row (the assignment, the attempt or the
// draft), the RPC starts on another connection and waits on it, and a third connection tries the other rows with NOWAIT.
// If the RPC had taken a child before its parent, NOWAIT fails with 55P03 on a row that has to be free; if it did not take
// the parent first, a row that has to be locked is free. waitedOn is not enough on its own: it would also accept a wait
// further down. Placeholder text only.

function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "error";
}

/** "free", or the SQLSTATE the NOWAIT failed with (55P03: locked by someone else). A failure aborts the transaction: a fresh one starts. */
async function nowait(prober: Session, sql: string, id: string): Promise<string> {
  try {
    await prober.rows(sql, [id]);
    return "free";
  } catch (thrown) {
    await prober.rollback();
    await prober.beginAsOwner();
    return codeOf(thrown);
  }
}

const ASSIGNMENT_ROW = "select id from app.assignments where id = $1 for update nowait";
const ATTEMPT_ROW = "select id from app.assignment_attempts where id = $1 for update nowait";
const DRAFT_ROW = "select id from app.submissions where attempt_id = $1 for update nowait";

type Held = { waitedOn: string | null; result: string; states: Record<string, string> };

/** The step waits behind `hold`; `probe` looks at the locks it already took, from a third connection. */
async function whileWaiting(
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

const holdAssignment = (s: Student) => async (holder: Session) => {
  await holder.rows("select id from app.assignments where id = $1 for update", [s.assignmentId]);
};
const holdAttempt = (s: Student) => async (holder: Session) => {
  await holder.rows("select id from app.assignment_attempts where id = $1 for update", [s.attemptId]);
};
const holdDraft = (s: Student) => async (holder: Session) => {
  await holder.rows("select id from app.submissions where attempt_id = $1 for update", [s.attemptId]);
};

type Case = { name: string; prepare: (p: Published, s: Student) => Promise<void>; step: (p: Published, s: Student) => Step };

// Start works on an opened attempt (it has no draft yet); save and submit on one that started, with its draft.
const CASES: Case[] = [
  { name: "student_start_attempt", prepare: async () => undefined, step: (_p, s) => startStep(s) },
  { name: "student_save_draft", prepare: (p, s) => startedWithDraft(p, s), step: (p, s) => saveStep(p, s, { revision: 2, text: "segunda" }) },
  { name: "student_submit_attempt", prepare: (p, s) => startedWithDraft(p, s), step: (_p, s) => submitStep(s, 2) },
];

describe.each(CASES)("race: $name takes the assignment, then the attempt, then the draft", ({ name, prepare, step }) => {
  const hasDraft = name !== "student_start_attempt";

  it("waits on the assignment and has taken neither the attempt nor the draft", async () => {
    const p = await published(1);
    const s = p.students[0];
    if (!s) throw new Error("Falta el estudiante.");
    await prepare(p, s);
    const held = await whileWaiting(step(p, s), holdAssignment(s), async (prober) => ({
      attempt: await nowait(prober, ATTEMPT_ROW, s.attemptId),
      draft: await nowait(prober, DRAFT_ROW, s.attemptId),
    }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    expect(held.states).toEqual({ attempt: "free", draft: "free" });
  });

  it("waits on the attempt already holding the assignment, and has not taken the draft", async () => {
    const p = await published(1);
    const s = p.students[0];
    if (!s) throw new Error("Falta el estudiante.");
    await prepare(p, s);
    const held = await whileWaiting(step(p, s), holdAttempt(s), async (prober) => ({
      assignment: await nowait(prober, ASSIGNMENT_ROW, s.assignmentId),
      draft: await nowait(prober, DRAFT_ROW, s.attemptId),
    }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    expect(held.states).toEqual({ assignment: "55P03", draft: "free" });
  });

  it.runIf(hasDraft)("waits on the draft already holding the assignment and the attempt", async () => {
    const p = await published(1);
    const s = p.students[0];
    if (!s) throw new Error("Falta el estudiante.");
    await prepare(p, s);
    const held = await whileWaiting(step(p, s), holdDraft(s), async (prober) => ({
      assignment: await nowait(prober, ASSIGNMENT_ROW, s.assignmentId),
      attempt: await nowait(prober, ATTEMPT_ROW, s.attemptId),
    }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    expect(held.states).toEqual({ assignment: "55P03", attempt: "55P03" });
  });
});

describe("race: opening an attempt", () => {
  it("takes no assignment lock: it does not wait for one held by a publication, and answers", async () => {
    const p = await published(1);
    const s = p.students[0];
    if (!s) throw new Error("Falta el estudiante.");
    const held = await whileWaiting(openStep(s), holdAssignment(s), async () => ({}));
    expect(held.waitedOn).toBeNull();
    expect(held.result).toBe("ok");
  });
});
