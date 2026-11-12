import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { original, pick, type Original } from "../support/assessments";
import { countRows, readRows, runRpc } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome, idOf } from "../support/session";
import { createStudent, teacherOf } from "../support/world";

// Versions of an assessment under concurrent writers (T1.4b). Every write of a version takes the
// assessment row first (create_version, set_version_recipients, update_version_config, archive_version),
// because the rules "a version made in the middle gets the stale mark" and "one version of an
// assessment per student at a time" belong to the assessment, not to one version. Each held race fails
// when its lock is missing: the second call would not block, or it would end in a raw 23505 instead of
// the code the contract promises. Placeholder text only.

const CONFIG = JSON.stringify({ profiles: ["motor"], supports: [], interests: [] });

function createVersion(o: Original, opKey: string = randomUUID(), config: string = CONFIG): Step {
  const args = { p_assessment_id: o.assessmentId, p_config: config, p_answer_mode: "typed", p_op_key: opKey, p_base_version_id: null };
  return { actor: teacherOf(o.world), rpc: "create_version", args };
}
type Recipients = { version: string; students: string[]; opId?: string };
function setRecipients(o: Original, spec: Recipients): Step {
  const args = { p_version_id: spec.version, p_revision: 1, p_student_ids: spec.students, p_op_id: spec.opId ?? randomUUID() };
  return { actor: teacherOf(o.world), rpc: "set_version_recipients", args };
}
function editExercise(o: Original, id: string, body: string): Step {
  const args = { p_exercise_id: id, p_revision: 1, p_label: "1", p_body: body, p_topic_id: null };
  return { actor: teacherOf(o.world), rpc: "update_exercise", args };
}

async function makeVersion(o: Original, config: string = CONFIG): Promise<string> {
  return idOf(await runRpc(teacherOf(o.world), "create_version", createVersion(o, randomUUID(), config).args));
}

/** Another assessment of the same group (same institution), with one exercise. */
async function anotherAssessment(o: Original): Promise<Original> {
  const teacher = teacherOf(o.world);
  const created = { p_group_id: o.world.groupId, p_kind: "worksheet", p_topic: "Otro", p_general_instructions: "", p_op_key: randomUUID() };
  const assessmentId = idOf(await runRpc(teacher, "create_assessment", created));
  const exercise = { p_assessment_id: assessmentId, p_label: "1", p_body: "Enunciado", p_op_key: randomUUID(), p_topic_id: null };
  const added = await runRpc(teacher, "add_exercise", exercise);
  return { world: o.world, assessmentId, exercises: [idOf(added)] };
}

const COPIES =
  "select v.stale, ve.source_revision from app.versions v join app.version_exercises ve on ve.version_id = v.id where v.assessment_id = $1";
const OPEN_ROWS = "select count(*)::text as n from app.version_recipients where assessment_id = $1 and student_id = $2 and valid_to is null";
const VERSIONS = "select count(*)::text as n from app.versions where assessment_id = $1";

describe("race: create_version against an exercise edit of the same assessment", () => {
  it("a version that commits first is found by the edit, which marks it stale", async () => {
    const o = await original(1);
    const [one] = pick(o, 1);
    const held = await heldRace(createVersion(o), editExercise(o, one, "Editado"));
    expect(held.first.ok).toBe(true);
    // The assessment row is what makes the edit wait for the version. Without it, the edit would run
    // against a world without that version, mark nothing and leave it adapted from the old text.
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("ok");
    const rows = await readRows<{ stale: boolean; source_revision: number }>(COPIES, [o.assessmentId]);
    expect(rows).toEqual([{ stale: true, source_revision: 1 }]);
  });

  it("an edit that commits first is copied as it is: the version is born up to date", async () => {
    const o = await original(1);
    const [one] = pick(o, 1);
    const held = await heldRace(editExercise(o, one, "Editado"), createVersion(o));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("ok");
    const rows = await readRows<{ stale: boolean; source_revision: number }>(COPIES, [o.assessmentId]);
    expect(rows).toEqual([{ stale: false, source_revision: 2 }]);
  });
});

describe("race: create_version against a removal of an exercise", () => {
  it("a removal that commits first: the version is born without the removed exercise", async () => {
    const o = await original(2);
    const [one, two] = pick(o, 2);
    const remove: Step = { actor: teacherOf(o.world), rpc: "remove_exercise", args: { p_exercise_id: two, p_revision: 1 } };
    const held = await heldRace(remove, createVersion(o));
    expect(held.first.ok).toBe(true);
    // The assessment row is taken before the live exercises are read. Without it the version would
    // read both (the removal is not committed), wait on the foreign key and copy the removed one.
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("ok");
    const rows = await readRows<{ exercise_id: string }>(
      "select ve.exercise_id from app.version_exercises ve join app.versions v on v.id = ve.version_id where v.assessment_id = $1",
      [o.assessmentId],
    );
    expect(rows.map((row) => row.exercise_id)).toEqual([one]);
  });
});

describe("race: create_version with the same op_key, and many at once", () => {
  it("two creates with the same op_key: the second waits and answers the same version", async () => {
    const o = await original(1);
    const key = randomUUID();
    const held = await heldRace(createVersion(o, key), createVersion(o, key));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).toBe("advisory");
    expect(held.second).toEqual(held.first);
    expect(await countRows(VERSIONS, [o.assessmentId])).toBe(1);
  });

  it("the same op_key with another configuration waits and is CONFLICT op_key_reused", async () => {
    const o = await original(1);
    const key = randomUUID();
    const held = await heldRace(createVersion(o, key), createVersion(o, key, JSON.stringify({ profiles: ["adhd"], supports: [], interests: [] })));
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(VERSIONS, [o.assessmentId])).toBe(1);
  });

  it("six creates at once with different keys take six different positions, 5 times", async () => {
    for (let round = 0; round < 5; round += 1) {
      const o = await original(1);
      const outcomes = await stampede(Array.from({ length: 6 }, () => createVersion(o)));
      expect(outcomes.map(describeOutcome), `round ${round}`).toEqual(Array(6).fill("ok"));
      const positions = await readRows<{ position: number }>("select position from app.versions where assessment_id = $1 order by position", [o.assessmentId]);
      expect(
        positions.map((row) => row.position),
        `round ${round}`,
      ).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });
});

describe("race: set_version_recipients", () => {
  it("the same student in two versions of one assessment: the second waits and is CONFLICT, never two open rows", async () => {
    const o = await original(1);
    const student = await createStudent(o.world);
    const [one, two] = [await makeVersion(o), await makeVersion(o)];
    const held = await heldRace(setRecipients(o, { version: one, students: [student] }), setRecipients(o, { version: two, students: [student] }));
    expect(held.first.ok).toBe(true);
    // The assessment row is what orders two versions. Without it the second would pass the check
    // (it cannot see the first's row), wait on the unique index and end in a raw 23505.
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT recipient_in_other_version");
    expect(await countRows(OPEN_ROWS, [o.assessmentId, student])).toBe(1);
  });

  it("four versions asking for the same student at once: one wins, the others are CONFLICT, 5 times", async () => {
    for (let round = 0; round < 5; round += 1) {
      const o = await original(1);
      const student = await createStudent(o.world);
      const versions = await Promise.all([makeVersion(o), makeVersion(o), makeVersion(o), makeVersion(o)]);
      const outcomes = await stampede(versions.map((id) => setRecipients(o, { version: id, students: [student] })));
      const described = outcomes.map(describeOutcome).sort();
      expect(described, `round ${round}`).toEqual(["P0001 CONFLICT recipient_in_other_version", "P0001 CONFLICT recipient_in_other_version", "P0001 CONFLICT recipient_in_other_version", "ok"]);
      expect(await countRows(OPEN_ROWS, [o.assessmentId, student]), `round ${round}`).toBe(1);
    }
  });

  it("an enrollment that ends first: the recipient is refused (the trigger takes the enrollment lock)", async () => {
    const o = await original(1);
    const student = await createStudent(o.world);
    const version = await makeVersion(o);
    const unenroll: Step = {
      actor: teacherOf(o.world),
      rpc: "unenroll_student",
      args: { p_group_id: o.world.groupId, p_student_id: student },
    };
    const held = await heldRace(unenroll, setRecipients(o, { version: version, students: [student] }));
    expect(held.first.ok).toBe(true);
    // Without the lock the second would read the enrollment as still active (the end is not
    // committed), would not wait, and would leave a recipient who is no longer in the group.
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("P0001 INVALID not_enrolled");
    expect(await countRows(OPEN_ROWS, [o.assessmentId, student])).toBe(0);
  });

  it("the same op_id on versions of two assessments: the second waits on the event and is CONFLICT op_key_reused", async () => {
    const o = await original(1);
    const other = await anotherAssessment(o);
    const [studentA, studentB] = [await createStudent(o.world), await createStudent(o.world)];
    const [versionA, versionB] = [await makeVersion(o), await makeVersion(other)];
    const opId = randomUUID();
    const held = await heldRace(setRecipients(o, { version: versionA, students: [studentA], opId }), setRecipients(other, { version: versionB, students: [studentB], opId }));
    expect(held.first.ok).toBe(true);
    // Different assessments, different version rows: only the unique index of the event orders them,
    // and the RPC turns its violation into the protocol's error.
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(OPEN_ROWS, [other.assessmentId, studentB])).toBe(0);
  });

  it("two copies of one request: the second answers the stored result", async () => {
    const o = await original(1);
    const student = await createStudent(o.world);
    const version = await makeVersion(o);
    const opId = randomUUID();
    const held = await heldRace(setRecipients(o, { version, students: [student], opId }), setRecipients(o, { version, students: [student], opId }));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second).toEqual(held.first);
    expect(await countRows(OPEN_ROWS, [o.assessmentId, student])).toBe(1);
    expect(await countRows("select count(*)::text as n from app.version_events where version_id = $1", [version])).toBe(1);
  });
});

describe("race: archive_version and update_version_config against set_version_recipients", () => {
  it("an archive that commits first: the recipients are refused", async () => {
    const o = await original(1);
    const student = await createStudent(o.world);
    const version = await makeVersion(o);
    const archive: Step = { actor: teacherOf(o.world), rpc: "archive_version", args: { p_version_id: version, p_revision: 1 } };
    const held = await heldRace(archive, setRecipients(o, { version: version, students: [student] }));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    // The second finds the version archived under the lock: refused, not written.
    expect(describeOutcome(held.second)).toBe("P0001 INVALID version_archived");
    expect(await countRows(OPEN_ROWS, [o.assessmentId, student])).toBe(0);
  });

  it("recipients that commit first: a configuration edit made with the old revision is CONFLICT", async () => {
    const o = await original(1);
    const student = await createStudent(o.world);
    const version = await makeVersion(o);
    const reconfigure: Step = {
      actor: teacherOf(o.world),
      rpc: "update_version_config",
      args: { p_version_id: version, p_revision: 1, p_config: JSON.stringify({ profiles: ["adhd"], supports: [], interests: [] }), p_answer_mode: "typed" },
    };
    const held = await heldRace(setRecipients(o, { version: version, students: [student] }), reconfigure);
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
  });
});
