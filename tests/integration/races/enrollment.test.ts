import { describe, expect, it } from "vitest";
import { countRows, openSession, readRows, runRpc } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome, idOf } from "../support/session";
import { createGroup, createStudent, createWorld, teacherOf, type World } from "../support/world";

// W2-3 (c): enroll_student against unenroll_student of the same (group, student) pair.

const ACTIVE = "select id from app.enrollments where group_id = $1 and student_id = $2 and ended_at is null";
const ACTIVE_COUNT = "select count(*)::text as n from app.enrollments where group_id = $1 and student_id = $2 and ended_at is null";

async function enrolledPair(): Promise<{ world: World; groupId: string; studentId: string; enroll: Step; unenroll: Step }> {
  const world = await createWorld();
  const groupId = await createGroup(world);
  const studentId = await createStudent(world);
  const args = { p_group_id: groupId, p_student_id: studentId };
  const enroll: Step = { actor: teacherOf(world), rpc: "enroll_student", args };
  const unenroll: Step = { actor: teacherOf(world), rpc: "unenroll_student", args };
  expect(describeOutcome(await runRpc(enroll.actor, enroll.rpc, enroll.args))).toBe("ok");
  return { world, groupId, studentId, enroll, unenroll };
}

describe("race: enroll against unenroll", () => {
  it("an enroll that arrives while the enrollment is ending answers the new one, never a null id", async () => {
    const { groupId, studentId, enroll, unenroll } = await enrolledPair();
    const held = await heldRace(unenroll, enroll);
    expect(held.waitedOn).toBe("advisory");
    const ended = idOf(held.first);
    const answered = idOf(held.second);
    // Without the pair lock, the enroll sees the enrollment still active and answers its id, which
    // the unenroll then ends: success with nobody enrolled.
    expect(answered).not.toBe(ended);
    expect((await readRows<{ id: string }>(ACTIVE, [groupId, studentId])).map((row) => row.id)).toEqual([answered]);
  });

  it("an unenroll that arrives after an enroll ends the enrollment the enroll answered", async () => {
    const { groupId, studentId, enroll, unenroll } = await enrolledPair();
    const held = await heldRace(enroll, unenroll);
    expect(held.waitedOn).toBe("advisory");
    expect(idOf(held.second)).toBe(idOf(held.first));
    expect(await countRows(ACTIVE_COUNT, [groupId, studentId])).toBe(0);
  });

  it("never answers a null id or leaves two active enrollments, 20 times", async () => {
    const { groupId, studentId, enroll, unenroll } = await enrolledPair();
    for (let round = 0; round < 20; round += 1) {
      const outcomes = await stampede([enroll, unenroll, enroll, unenroll]);
      const unexpected = outcomes.filter((outcome) => !outcome.ok).map(describeOutcome);
      expect(unexpected, `round ${round}`).toEqual([]);
      for (const outcome of outcomes) if (outcome.ok) expect(typeof idOf(outcome)).toBe("string");
      expect(await countRows(ACTIVE_COUNT, [groupId, studentId]), `round ${round}`).toBeLessThanOrEqual(1);
      await stampede([enroll]);
    }
  });
});

// now() is the start of the transaction, not the moment it got the lock. An unenroll that began before
// an enroll of the same pair, and ran after it, must not end the enrollment "before" it started (raw
// 23514 from enrollments_check): unenroll_student reads clock_timestamp() after the lock (T1.F2).
describe("race: the clock of a transaction that waited", () => {
  it("an unenroll that began earlier than the enroll it follows ends that enrollment", async () => {
    const { world, groupId, studentId, enroll, unenroll } = await enrolledPair();
    await runRpc(unenroll.actor, unenroll.rpc, unenroll.args);
    const [late, early] = [await openSession(), await openSession()];
    try {
      await early.begin(teacherOf(world));
      await late.begin(teacherOf(world));
      expect(describeOutcome(await late.call(enroll.rpc, enroll.args))).toBe("ok");
      await late.commit();
      expect(describeOutcome(await early.call(unenroll.rpc, unenroll.args))).toBe("ok");
      await early.commit();
      expect(await countRows(ACTIVE_COUNT, [groupId, studentId])).toBe(0);
    } finally {
      await Promise.all([late.close(), early.close()]);
    }
  });
});
