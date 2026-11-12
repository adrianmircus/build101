import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { countRows, readRows } from "../support/db";
import { stampede } from "../support/race";
import { describeOutcome } from "../support/session";
import {
  EVENTS,
  EXERCISE_ROW,
  QUESTION_ROW,
  approval,
  at,
  exerciseEdit,
  exerciseState,
  fill,
  fixture,
  heldRaceProbed,
  instructionsEdit,
  keyEdit,
  questionEdit,
  rejection,
  versionState,
} from "./version-ops-support";

// The content of a version and its approval under concurrent writers (T1.4c). Every write of the content
// takes the version first (app.lock_version_tree), so the version row is what orders two edits. These tests
// hold the first transaction open, start the second on another connection, wait to see it blocked and only
// then let the first commit. Two copies of one request: the second waits, finds the event of the first and
// answers the same. Without the lock it applies the edit again and ends in CONFLICT op_key_reused from the
// unique index of the event (or in a raw 23505 for a key). One op_id for two targets, and a revision the
// first writer already moved, are in version-ops-targets.test.ts. Placeholder text only.

describe("race: two copies of the same edit apply once and the second answers the same", () => {
  it("update_version_exercise", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const opId = randomUUID();
    const step = exerciseEdit(f, { exercise, body: "Texto", opId });
    const held = await heldRaceProbed(step, step, { sql: EXERCISE_ROW, id: exercise });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second).toEqual(held.first);
    expect(await countRows(EVENTS, [opId])).toBe(1);
    expect(await exerciseState(exercise)).toEqual({ revision: 2, body: "Texto", status: "ready" });
    expect((await versionState(f.version)).revision).toBe(2);
  });

  it("update_version_instructions", async () => {
    const f = await fixture(1);
    const opId = randomUUID();
    const step = instructionsEdit(f, { text: "Nuevas", opId });
    const held = await heldRaceProbed(step, step, { sql: EXERCISE_ROW, id: at(f.adapted, 0) });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second).toEqual(held.first);
    expect(await countRows(EVENTS, [opId])).toBe(1);
    expect((await versionState(f.version)).revision).toBe(2);
  });

  it("update_version_question", async () => {
    const f = await fixture(2, true);
    const question = at(f.questions, 0);
    const opId = randomUUID();
    const step = questionEdit(f, { question, stem: "Nuevo", opId });
    const held = await heldRaceProbed(step, step, { sql: QUESTION_ROW, id: question });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second).toEqual(held.first);
    expect(await countRows(EVENTS, [opId])).toBe(1);
    const rows = await readRows<{ revision: number }>("select revision from app.version_questions where id = $1", [question]);
    expect(at(rows, 0).revision).toBe(2);
  });

  it("set_question_key: the second finds the key and answers it, never a raw 23505", async () => {
    const f = await fixture(2, true);
    const question = at(f.questions, 0);
    const step = keyEdit(f, { question, option: "B" });
    const held = await heldRaceProbed(step, step, { sql: QUESTION_ROW, id: question });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second).toEqual(held.first);
    expect(await countRows("select count(*)::text as n from app.question_keys where question_id = $1", [question])).toBe(1);
    const events = "select count(*)::text as n from app.version_events where target_id = $1 and operation = 'set_question_key'";
    expect(await countRows(events, [question])).toBe(1);
  });

  it("two different options for a question without key: the second is CONFLICT revision_mismatch, one key", async () => {
    const f = await fixture(2, true);
    const question = at(f.questions, 0);
    const held = await heldRaceProbed(keyEdit(f, { question, option: "A" }), keyEdit(f, { question, option: "B" }), { sql: QUESTION_ROW, id: question });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    const keys = await readRows<{ correct_option_id: string }>("select correct_option_id from app.question_keys where question_id = $1", [question]);
    expect(keys).toEqual([{ correct_option_id: "A" }]);
  });

  it("approve_version", async () => {
    const f = await fixture(2);
    const revision = await fill(f);
    const opId = randomUUID();
    const step = approval(f, { revision, opId });
    const held = await heldRaceProbed(step, step, { sql: EXERCISE_ROW, id: at(f.adapted, 0) });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second).toEqual(held.first);
    expect(await countRows(EVENTS, [opId])).toBe(1);
    expect(await versionState(f.version)).toEqual({ revision, approved_revision: revision });
  });

  it("reject_version", async () => {
    const f = await fixture(1);
    const opId = randomUUID();
    const step = rejection(f, { revision: 1, opId });
    const held = await heldRaceProbed(step, step, { sql: EXERCISE_ROW, id: at(f.adapted, 0) });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second).toEqual(held.first);
    expect(await countRows(EVENTS, [opId])).toBe(1);
  });

  it("six copies at once: all answer the same, one event, 5 times", async () => {
    for (let round = 0; round < 5; round += 1) {
      const f = await fixture(1);
      const exercise = at(f.adapted, 0);
      const opId = randomUUID();
      const outcomes = await stampede(Array.from({ length: 6 }, () => exerciseEdit(f, { exercise, body: "Texto", opId })));
      const first = at(outcomes, 0);
      expect(first.ok, `round ${round}`).toBe(true);
      for (const outcome of outcomes) expect(outcome, `round ${round}`).toEqual(first);
      expect(await countRows(EVENTS, [opId]), `round ${round}`).toBe(1);
      expect((await exerciseState(exercise)).revision, `round ${round}`).toBe(2);
    }
  });
});
