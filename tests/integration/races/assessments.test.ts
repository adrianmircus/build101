import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { original, pick, type Original } from "../support/assessments";
import { countRows, readRows } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome, idOf } from "../support/session";
import { teacherOf } from "../support/world";

// The original of an assessment under concurrent edits (T1.4a). Every write of an exercise takes the
// assessment row first, so reorder compares the exact set of live exercises and two edits of one
// exercise are ordered. Each held race fails on `waitedOn` when the lock is missing: the second call
// would not block and would run against a world without the first one's change. Placeholder text only.

const MISMATCH = "P0001 INVALID exercises_mismatch";
const STALE_EDIT = "P0001 CONFLICT revision_mismatch";

function addExercise(o: Original, label: string): Step {
  return {
    actor: teacherOf(o.world),
    rpc: "add_exercise",
    args: { p_assessment_id: o.assessmentId, p_label: label, p_body: "Enunciado nuevo", p_op_key: randomUUID(), p_topic_id: null },
  };
}
function removeExercise(o: Original, id: string, revision: number): Step {
  return { actor: teacherOf(o.world), rpc: "remove_exercise", args: { p_exercise_id: id, p_revision: revision } };
}
function reorder(o: Original, ids: string[], revision = 1): Step {
  return {
    actor: teacherOf(o.world),
    rpc: "reorder_exercises",
    args: { p_assessment_id: o.assessmentId, p_revision: revision, p_exercise_ids: ids },
  };
}
function editExercise(o: Original, id: string, body: string): Step {
  return {
    actor: teacherOf(o.world),
    rpc: "update_exercise",
    args: { p_exercise_id: id, p_revision: 1, p_label: "1", p_body: body, p_topic_id: null },
  };
}

async function liveOrder(assessmentId: string): Promise<string[]> {
  const rows = await readRows<{ id: string }>(
    "select id from app.assessment_exercises where assessment_id = $1 and removed_at is null order by position, id",
    [assessmentId],
  );
  return rows.map((row) => row.id);
}
async function positions(assessmentId: string): Promise<string> {
  const rows = await readRows<{ p: string }>(
    "select string_agg(position::text, ',' order by position) as p from app.assessment_exercises where assessment_id = $1 and removed_at is null",
    [assessmentId],
  );
  return rows[0]?.p ?? "";
}

describe("race: reorder_exercises against add and remove", () => {
  it("an add that commits first makes the reorder see a set that changed", async () => {
    const o = await original(2);
    const [one, two] = pick(o, 2);
    const held = await heldRace(addExercise(o, "3"), reorder(o, [two, one]));
    expect(held.first.ok).toBe(true);
    // The assessment row is what made the reorder wait. Without that lock it would not block, would
    // read two exercises and would answer ok around an exercise it never saw.
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe(MISMATCH);
    expect(await liveOrder(o.assessmentId)).toEqual([one, two, idOf(held.first)]);
    expect(await positions(o.assessmentId)).toBe("0,1,2");
  });

  it("a remove that commits first too: the removed exercise cannot be put back in the order", async () => {
    const o = await original(3);
    const [one, two, three] = pick(o, 3);
    const held = await heldRace(removeExercise(o, two, 1), reorder(o, [three, two, one]));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe(MISMATCH);
    expect(await liveOrder(o.assessmentId)).toEqual([one, three]);
  });

  it("a reorder that commits first makes the add wait and land last, with no position repeated", async () => {
    const o = await original(3);
    const [one, two, three] = pick(o, 3);
    const held = await heldRace(reorder(o, [three, one, two]), addExercise(o, "4"));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("ok");
    expect(await liveOrder(o.assessmentId)).toEqual([three, one, two, idOf(held.second)]);
    expect(await positions(o.assessmentId)).toBe("0,1,2,3");
  });

  it("a reorder that commits first makes a second one with the old revision a CONFLICT", async () => {
    const o = await original(2);
    const [one, two] = pick(o, 2);
    const held = await heldRace(reorder(o, [two, one]), reorder(o, [one, two]));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe(STALE_EDIT);
    expect(await liveOrder(o.assessmentId)).toEqual([two, one]);
  });

  it("holds when they run at once, 15 times: no position is repeated and no exercise is lost twice", async () => {
    for (let round = 0; round < 15; round += 1) {
      const o = await original(3);
      const [one, two, three] = pick(o, 3);
      await stampede([reorder(o, [three, two, one]), addExercise(o, "4"), removeExercise(o, two, 1)]);
      const live = await liveOrder(o.assessmentId);
      expect(new Set(live).size, `round ${round}`).toBe(live.length);
      const repeated = await countRows(
        "select count(*)::text as n from (select position from app.assessment_exercises where assessment_id = $1 and removed_at is null group by position having count(*) > 1) d",
        [o.assessmentId],
      );
      expect(repeated, `round ${round}`).toBe(0);
    }
  });
});

describe("race: two edits of the same exercise", () => {
  it("the second waits and, with the same revision, is CONFLICT: the first edit is not lost", async () => {
    const o = await original(1);
    const [one] = pick(o, 1);
    const held = await heldRace(editExercise(o, one, "Texto de la primera edición"), editExercise(o, one, "Texto de la segunda edición"));
    expect(held.first.ok).toBe(true);
    // Without the lock the second call does not block, reads revision 1 and overwrites the first
    // edit with its own, both answering revision 2.
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe(STALE_EDIT);
    const rows = await readRows<{ body: string; revision: number }>("select body, revision from app.assessment_exercises where id = $1", [one]);
    expect(rows[0]).toEqual({ body: "Texto de la primera edición", revision: 2 });
  });

  it("a remove that commits first leaves the edit with an exercise that is gone", async () => {
    const o = await original(1);
    const [one] = pick(o, 1);
    const held = await heldRace(removeExercise(o, one, 1), editExercise(o, one, "Texto tardío"));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 NOT_FOUND not_found");
    expect(await liveOrder(o.assessmentId)).toEqual([]);
  });

  it("two edits at once with the same revision: exactly one answers ok, 15 times", async () => {
    for (let round = 0; round < 15; round += 1) {
      const o = await original(1);
      const [one] = pick(o, 1);
      const outcomes = await stampede([editExercise(o, one, "Primera"), editExercise(o, one, "Segunda")]);
      expect(outcomes.map(describeOutcome).sort(), `round ${round}`).toEqual([STALE_EDIT, "ok"]);
    }
  });
});

describe("race: marking versions stale takes the locks in order", () => {
  async function seedVersions(o: Original): Promise<void> {
    for (const position of [1, 2]) {
      const rows = await readRows<{ id: string }>(
        "insert into app.versions (institution_id, assessment_id, position, general_instructions) values ($1, $2, $3, 'Copia') returning id",
        [o.world.institutionId, o.assessmentId, String(position)],
      );
      const versionId = rows[0]?.id;
      if (!versionId) throw new Error("No se creó la versión.");
      for (const exercise of o.exercises) {
        await readRows(
          "insert into app.version_exercises (institution_id, assessment_id, version_id, exercise_id, source_revision, body) values ($1, $2, $3, $4, 1, 'Copia adaptada')",
          [o.world.institutionId, o.assessmentId, versionId, exercise],
        );
      }
    }
  }

  it("edits, removals, instruction changes and reorders at once never deadlock and never touch a copy, 10 times", async () => {
    for (let round = 0; round < 10; round += 1) {
      const o = await original(3);
      await seedVersions(o);
      const [one, two, three] = pick(o, 3);
      const outcomes = await stampede([
        editExercise(o, one, "Editado"),
        removeExercise(o, two, 1),
        {
          actor: teacherOf(o.world),
          rpc: "update_assessment",
          args: { p_assessment_id: o.assessmentId, p_revision: 1, p_kind: "exam", p_topic: "Repaso", p_general_instructions: "Instrucciones nuevas" },
        },
        reorder(o, [three, two, one]),
      ]);
      // A refusal of the protocol (P0001) is fine; a deadlock (40P01) or any other failure is not.
      for (const outcome of outcomes) expect(outcome.ok || outcome.state === "P0001", `round ${round}: ${describeOutcome(outcome)}`).toBe(true);
      const copies = await readRows<{ body: string; instructions: string }>(
        "select distinct ve.body, v.general_instructions as instructions from app.version_exercises ve join app.versions v on v.id = ve.version_id where ve.assessment_id = $1",
        [o.assessmentId],
      );
      expect(copies, `round ${round}`).toEqual([{ body: "Copia adaptada", instructions: "Copia" }]);
      const stale = await countRows("select count(*)::text as n from app.versions where assessment_id = $1 and stale", [o.assessmentId]);
      expect(stale, `round ${round}`).toBe(2);
    }
  });
});

