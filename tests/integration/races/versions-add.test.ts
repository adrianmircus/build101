import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { original, type Original } from "../support/assessments";
import { readRows } from "../support/db";
import { heldRace, type Step } from "../support/race";
import { describeOutcome, idOf } from "../support/session";
import { teacherOf } from "../support/world";

// Split from versions.test.ts (T1.4b): an exercise added while a version is being made. Both take the
// assessment row first, so each one sees the other whole: the version either has the new exercise or
// it does not, never half of it. Each held race fails when the lock is missing: the second call would
// not block and would read the world without the first one's exercise (or version). Placeholder text only.

const CONFIG = JSON.stringify({ profiles: ["motor"], supports: [], interests: [] });

function createVersion(o: Original): Step {
  const args = { p_assessment_id: o.assessmentId, p_config: CONFIG, p_answer_mode: "typed", p_op_key: randomUUID(), p_base_version_id: null };
  return { actor: teacherOf(o.world), rpc: "create_version", args };
}
function addExercise(o: Original): Step {
  const args = { p_assessment_id: o.assessmentId, p_label: "9", p_body: "Enunciado agregado", p_op_key: randomUUID(), p_topic_id: null };
  return { actor: teacherOf(o.world), rpc: "add_exercise", args };
}
const COPIED = "select ve.exercise_id from app.version_exercises ve join app.versions v on v.id = ve.version_id where v.assessment_id = $1";

describe("race: add_exercise against create_version of the same assessment", () => {
  it("an exercise that commits first is copied: the version is born with it", async () => {
    const o = await original(1);
    const held = await heldRace(addExercise(o), createVersion(o));
    expect(held.first.ok).toBe(true);
    // The assessment row makes the version wait. Without it the version would read the live exercises
    // without the one that is not committed and be born without it.
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("ok");
    const copied = (await readRows<{ exercise_id: string }>(COPIED, [o.assessmentId])).map((row) => row.exercise_id);
    expect(copied.sort()).toEqual([...o.exercises, idOf(held.first)].sort());
  });

  it("a version that commits first has the exercises it was made from: the new one waits and is not copied", async () => {
    const o = await original(1);
    const held = await heldRace(createVersion(o), addExercise(o));
    expect(held.first.ok).toBe(true);
    // The add waits for the assessment row the version holds, then adds after it.
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("ok");
    const copied = (await readRows<{ exercise_id: string }>(COPIED, [o.assessmentId])).map((row) => row.exercise_id);
    expect(copied).toEqual(o.exercises);
    const live = await readRows<{ id: string }>("select id from app.assessment_exercises where assessment_id = $1 and removed_at is null", [o.assessmentId]);
    expect(live.map((row) => row.id)).toContain(idOf(held.second));
  });
});
