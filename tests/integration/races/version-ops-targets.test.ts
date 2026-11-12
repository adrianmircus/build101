import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { countRows, readRows } from "../support/db";
import { describeOutcome } from "../support/session";
import { teacherOf } from "../support/world";
import type { Step } from "../support/race";
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
  questionEdit,
  versionState,
} from "./version-ops-support";

// Races of T1.4c, second part (the first, two copies of one request, is in version-ops.test.ts).
//   * One op_id used for two targets is CONFLICT op_key_reused in one of them. The second waits at the
//     version and, while it waits, it holds no lock on its own target (`probe` "free"): the version lock
//     comes before anything else. Without the lock it would already have written its target and the probe
//     would find it locked (the unique index of the event would still turn it into the same CONFLICT, so
//     the probe is what shows the lock). When both calls edit the same row the probe cannot tell.
//   * A revision the first writer already moved: the second edit, made from the old one, is CONFLICT
//     revision_mismatch. Without the lock it would read the old revision and overwrite.
// Placeholder text only.

describe("race: one op_id for two targets is CONFLICT op_key_reused in one of them", () => {
  it("two different exercises of the same version: the second waits at the version and touches nothing", async () => {
    const f = await fixture(2);
    const [one, two] = [at(f.adapted, 0), at(f.adapted, 1)];
    const opId = randomUUID();
    const held = await heldRaceProbed(exerciseEdit(f, { exercise: one, body: "Uno", opId }), exerciseEdit(f, { exercise: two, body: "Dos", opId }), {
      sql: EXERCISE_ROW,
      id: two,
    });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.probe).toBe("free");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(EVENTS, [opId])).toBe(1);
    expect(await exerciseState(two)).toEqual({ revision: 1, body: "", status: "pending" });
  });

  it("two questions of the same exercise", async () => {
    const f = await fixture(2, true);
    const [one, two] = [at(f.questions, 0), at(f.questions, 1)];
    const opId = randomUUID();
    const held = await heldRaceProbed(questionEdit(f, { question: one, stem: "Uno", opId }), questionEdit(f, { question: two, stem: "Dos", opId }), {
      sql: QUESTION_ROW,
      id: two,
    });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.probe).toBe("free");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(EVENTS, [opId])).toBe(1);
    const rows = await readRows<{ stem: string; revision: number }>("select stem, revision from app.version_questions where id = $1", [two]);
    expect(rows).toEqual([{ stem: "Enunciado", revision: 1 }]);
  });

  it("a question and its exercise, in this order", async () => {
    const f = await fixture(2, true);
    const [question, exercise] = [at(f.questions, 0), at(f.adapted, 0)];
    const opId = randomUUID();
    const held = await heldRaceProbed(questionEdit(f, { question, stem: "Uno", opId }), exerciseEdit(f, { exercise, body: "Texto", opId, revision: 2 }), {
      sql: EXERCISE_ROW,
      id: exercise,
    });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(EVENTS, [opId])).toBe(1);
  });

  it("and its exercise first, then the question", async () => {
    const f = await fixture(2, true);
    const [question, exercise] = [at(f.questions, 0), at(f.adapted, 0)];
    const opId = randomUUID();
    const held = await heldRaceProbed(exerciseEdit(f, { exercise, body: "Texto", opId }), questionEdit(f, { question, stem: "Uno", opId }), {
      sql: QUESTION_ROW,
      id: question,
    });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.probe).toBe("free");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(EVENTS, [opId])).toBe(1);
  });

  it("an edit and an approval with the same op_id", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const opId = randomUUID();
    const held = await heldRaceProbed(exerciseEdit(f, { exercise, body: "Texto", opId }), approval(f, { revision: 1, opId }), { sql: EXERCISE_ROW, id: exercise });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(EVENTS, [opId])).toBe(1);
  });
});

describe("race: a revision the first writer already moved", () => {
  it("two different edits of one exercise from the same revision: the second is CONFLICT revision_mismatch", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const first = exerciseEdit(f, { exercise, body: "Primero", opId: randomUUID() });
    const held = await heldRaceProbed(first, exerciseEdit(f, { exercise, body: "Segundo", opId: randomUUID() }), { sql: EXERCISE_ROW, id: exercise });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect(await exerciseState(exercise)).toEqual({ revision: 2, body: "Primero", status: "ready" });
  });

  it("an edit that commits first: the approval of the revision the teacher saw is CONFLICT revision_mismatch", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const revision = await fill(f);
    const edit = exerciseEdit(f, { exercise, body: "Cambiado", opId: randomUUID(), revision: 2 });
    const held = await heldRaceProbed(edit, approval(f, { revision }), { sql: EXERCISE_ROW, id: exercise });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect(await versionState(f.version)).toEqual({ revision: revision + 1, approved_revision: null });
  });

  it("an approval that commits first: the edit lands after it and leaves the version unapproved", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const revision = await fill(f);
    const edit = exerciseEdit(f, { exercise, body: "Cambiado", opId: randomUUID(), revision: 2 });
    const held = await heldRaceProbed(approval(f, { revision }), edit, { sql: EXERCISE_ROW, id: exercise });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("ok");
    expect(await versionState(f.version)).toEqual({ revision: revision + 1, approved_revision: revision });
  });

  it("a configuration change that commits first: an approval of the old revision is CONFLICT", async () => {
    const f = await fixture(1);
    const revision = await fill(f);
    const config = JSON.stringify({ profiles: ["adhd"], supports: [], interests: [] });
    const reconfigure: Step = {
      actor: teacherOf(f.o.world),
      rpc: "update_version_config",
      args: { p_version_id: f.version, p_revision: revision, p_config: config, p_answer_mode: "gaze" },
    };
    const held = await heldRaceProbed(reconfigure, approval(f, { revision }), { sql: EXERCISE_ROW, id: at(f.adapted, 0) });
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect((await versionState(f.version)).approved_revision).toBeNull();
  });
});
