import { describe, expect, it } from "vitest";
import { openSession, readRows } from "../support/db";
import { waitUntilBlocked } from "../support/race";
import { describeOutcome, type Outcome, type Session } from "../support/session";
import { attemptRows, publishNow, publishStep, ready, type Ready } from "./publish-support";

// The lock order of publish_version (T1.5a): the assessment and the version first, then the assignments by id, and the
// attempts only after their assignment (assignment -> attempt, the order student_start_attempt follows). Each probe is
// deterministic and does not depend on which row the two calls fight for: a connection holds ONLY one parent (the
// version, or an assignment), publish_version starts on another connection and waits on it, and a third connection
// tries the rest with NOWAIT (or with pg_try_advisory_xact_lock). If publish had taken a child before its parent,
// NOWAIT fails with 55P03. waitedOn is not enough on its own: it would also accept a wait further down. Placeholder text
// only.

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

const ASSESSMENT_ROW = "select id from app.assessments where id = $1 for update nowait";
const VERSION_ROW = "select id from app.versions where id = $1 for update nowait";
const ASSIGNMENT_ROW = "select id from app.assignments where id = $1 for update nowait";
const ATTEMPT_ROW = "select id from app.assignment_attempts where assignment_id = $1 for update nowait";

type Held = { waitedOn: string | null; result: string; states: Record<string, string> };

/** The publication waits behind `hold`; `probe` looks at the locks it already took, from a third connection. */
async function whileWaiting(
  r: Ready,
  hold: (holder: Session) => Promise<void>,
  probe: (prober: Session) => Promise<Record<string, string>>,
): Promise<Held> {
  const [holder, caller, observer, prober] = await Promise.all([openSession(), openSession(), openSession(), openSession()]);
  try {
    await holder.beginAsOwner();
    await hold(holder);
    const step = await publishStep(r);
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

async function assignmentIds(r: Ready): Promise<string[]> {
  const rows = await readRows<{ id: string }>("select id::text from app.assignments where assessment_id = $1 order by id", [r.o.assessmentId]);
  return rows.map((row) => row.id);
}

describe("race: publish_version takes its parents before its children", () => {
  it("waits on the version and has taken no assignment, no attempt and no enrollment lock, but already holds the assessment", async () => {
    const r = await ready(1, 2);
    await publishNow(r);
    const assignments = await assignmentIds(r);
    const held = await whileWaiting(
      r,
      async (holder) => {
        await holder.rows("select id from app.versions where id = $1 for update", [r.version]);
      },
      async (prober) => {
        const states: Record<string, string> = { assessment: await nowait(prober, ASSESSMENT_ROW, r.o.assessmentId) };
        for (const [index, assignment] of assignments.entries()) {
          states[`assignment${index}`] = await nowait(prober, ASSIGNMENT_ROW, assignment);
          states[`attempt${index}`] = await nowait(prober, ATTEMPT_ROW, assignment);
        }
        for (const [index, student] of r.students.entries()) {
          const rows = await prober.rows<{ free: boolean }>(
            "select pg_try_advisory_xact_lock(hashtextextended('tiza.enrollment:' || $1::text || ':' || $2::text, 0)) as free",
            [r.o.world.groupId, student],
          );
          states[`enrollment${index}`] = rows[0]?.free ? "free" : "locked";
        }
        return states;
      },
    );
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    expect(held.states).toEqual({
      assessment: "55P03",
      assignment0: "free",
      attempt0: "free",
      assignment1: "free",
      attempt1: "free",
      enrollment0: "free",
      enrollment1: "free",
    });
  });

  it("waits on an assignment already holding the version and the assignments before it, and has no attempt", async () => {
    const r = await ready(1, 3);
    await publishNow(r);
    const [first, , last] = await assignmentIds(r);
    if (!first || !last) throw new Error("Faltan asignaciones.");
    const held = await whileWaiting(
      r,
      async (holder) => {
        await holder.rows("select id from app.assignments where id = $1 for update", [last]);
      },
      async (prober) => {
        const states: Record<string, string> = { version: await nowait(prober, VERSION_ROW, r.version), first: await nowait(prober, ASSIGNMENT_ROW, first) };
        for (const [index, assignment] of (await assignmentIds(r)).entries()) states[`attempt${index}`] = await nowait(prober, ATTEMPT_ROW, assignment);
        return states;
      },
    );
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    // The version and the first assignment (by id) are taken; no attempt is, not even the one of the assignment it holds.
    expect(held.states).toEqual({ version: "55P03", first: "55P03", attempt0: "free", attempt1: "free", attempt2: "free" });
    expect(await attemptRows(r.o.assessmentId)).toHaveLength(3);
  });
});
