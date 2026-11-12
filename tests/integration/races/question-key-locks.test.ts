import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSession, readRows } from "../support/db";
import { waitUntilBlocked } from "../support/race";
import { describeOutcome, type Outcome, type Session } from "../support/session";
import { teacherOf } from "../support/world";
import { EXERCISE_ROW, QUESTION_ROW, at, fixture, keyEdit, questionEdit, type Fixture } from "./version-ops-support";

// T14c-1: the lock order of the question RPCs is version -> exercise -> question. A writer that already
// holds the question or its exercise and then waits for the version would deadlock with another writer
// that goes version -> exercise -> question. The check is deterministic and does not depend on which row
// the two calls fight for: a connection holds ONLY the version (FOR UPDATE as owner), the RPC starts on
// another one and waits on it, and a third connection tries the question, its key and its exercise with
// NOWAIT. If the RPC had taken any of them before the version (lock_version_tree removed or delayed),
// NOWAIT fails with 55P03. Placeholder text only.

const KEY_ROW = "select id from app.question_keys where question_id = $1 for update nowait";

function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "error";
}

async function nowait(prober: Session, sql: string, id: string): Promise<string> {
  return prober.rows(sql, [id]).then(
    () => "free",
    (error: unknown) => codeOf(error),
  );
}

type Held = { waitedOn: string | null; question: string; key: string; exercise: string; ok: boolean; result: string };

async function holdingTheVersion(f: Fixture, target: { question: string; exercise: string }, call: (s: Session) => Promise<Outcome>): Promise<Held> {
  const [holder, caller, observer, prober] = await Promise.all([openSession(), openSession(), openSession(), openSession()]);
  try {
    await holder.beginAsOwner();
    await holder.rows("select id from app.versions where id = $1 for update", [f.version]);
    await caller.begin(teacherOf(f.o.world));
    let done = false;
    const pending = call(caller).finally(() => {
      done = true;
    });
    const waitedOn = await waitUntilBlocked(caller, observer, () => done);
    await prober.beginAsOwner();
    const held: Held = {
      waitedOn,
      question: await nowait(prober, QUESTION_ROW, target.question),
      key: await nowait(prober, KEY_ROW, target.question),
      exercise: await nowait(prober, EXERCISE_ROW, target.exercise),
      ok: false,
      result: "",
    };
    await prober.rollback();
    await holder.rollback();
    const outcome = await pending;
    held.ok = outcome.ok;
    held.result = describeOutcome(outcome);
    if (outcome.ok) await caller.commit();
    else await caller.rollback();
    return held;
  } finally {
    await Promise.all([holder.close(), caller.close(), observer.close(), prober.close()]);
  }
}

describe("race: the question RPCs take the version before the exercise and the question", () => {
  it("set_question_key waits on the version and holds neither the question, its key nor its exercise", async () => {
    const f = await fixture(2, true);
    const [question, exercise] = [at(f.questions, 0), at(f.adapted, 0)];
    // A key already there, so the probe also covers the key row.
    await readRows("insert into app.question_keys (institution_id, version_id, question_id, correct_option_id) values ($1, $2, $3, 'A')", [f.o.world.institutionId, f.version, question]);
    const base = keyEdit(f, { question, option: "B" });
    const step = { ...base, args: { ...base.args, p_revision: 1 } };
    const held = await holdingTheVersion(f, { question, exercise }, (s) => s.call(step.rpc, step.args));
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    expect(held).toMatchObject({ question: "free", key: "free", exercise: "free", ok: true });
  });

  it("update_version_question waits on the version and holds neither the question, its key nor its exercise", async () => {
    const f = await fixture(2, true);
    const [question, exercise] = [at(f.questions, 0), at(f.adapted, 0)];
    await readRows("insert into app.question_keys (institution_id, version_id, question_id, correct_option_id) values ($1, $2, $3, 'A')", [f.o.world.institutionId, f.version, question]);
    const step = questionEdit(f, { question, stem: "Otro enunciado", opId: randomUUID() });
    const held = await holdingTheVersion(f, { question, exercise }, (s) => s.call(step.rpc, step.args));
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    expect(held).toMatchObject({ question: "free", key: "free", exercise: "free", ok: true });
  });
});
