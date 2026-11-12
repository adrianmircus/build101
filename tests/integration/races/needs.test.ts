import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { countRows } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome } from "../support/session";
import { createStudent, createWorld, teacherOf, type World } from "../support/world";

// (f) set_student_needs with the same op_id at the same time (T1.3a). Health data: the tests use
// profile ids only, never a name or free text.

const EVENTS = "select count(*)::text as n from app.student_need_events where op_id = $1";
const CONFLICT = "P0001 CONFLICT op_key_reused";

function setNeeds(world: World, request: { studentId: string; opId: string; profiles: string[] }): Step {
  const { studentId, opId, profiles } = request;
  return {
    actor: teacherOf(world),
    rpc: "set_student_needs",
    args: { p_student_id: studentId, p_profiles: profiles, p_supports: [], p_interests: [], p_op_id: opId },
  };
}

describe("race: set_student_needs with the same op_id", () => {
  it("the same content answers the same result and writes one event", async () => {
    const world = await createWorld();
    const [student, opId] = [await createStudent(world), randomUUID()];
    const held = await heldRace(setNeeds(world, { studentId: student, opId: opId, profiles: ["adhd"] }), setNeeds(world, { studentId: student, opId: opId, profiles: ["adhd"] }));
    expect(held.first.ok).toBe(true);
    // The (institution, op_id) lock, not the student row, is what made the second one wait.
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(held.second).toEqual(held.first);
    expect(await countRows(EVENTS, [opId])).toBe(1);
  });

  it("other content is CONFLICT op_key_reused and writes nothing more", async () => {
    const world = await createWorld();
    const [student, opId] = [await createStudent(world), randomUUID()];
    const held = await heldRace(setNeeds(world, { studentId: student, opId: opId, profiles: ["adhd"] }), setNeeds(world, { studentId: student, opId: opId, profiles: ["dyslexia"] }));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe(CONFLICT);
    expect(await countRows(EVENTS, [opId])).toBe(1);
  });

  it("the same op_id for another student is CONFLICT: the unique index is never the first to answer", async () => {
    const world = await createWorld();
    const [one, two, opId] = [await createStudent(world), await createStudent(world), randomUUID()];
    const held = await heldRace(setNeeds(world, { studentId: one, opId: opId, profiles: ["adhd"] }), setNeeds(world, { studentId: two, opId: opId, profiles: ["adhd"] }));
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe(CONFLICT);
    expect(await countRows(EVENTS, [opId])).toBe(1);
  });

  it("holds when both run at once, 15 times", async () => {
    const world = await createWorld();
    const students = await Promise.all(Array.from({ length: 15 }, async () => [await createStudent(world), await createStudent(world)] as const));
    for (const [round, [student, fresh]] of students.entries()) {
      const opId = randomUUID();
      const same = await stampede([setNeeds(world, { studentId: student, opId: opId, profiles: ["adhd"] }), setNeeds(world, { studentId: student, opId: opId, profiles: ["adhd"] })]);
      expect(same.map(describeOutcome), `same content, round ${round}`).toEqual(["ok", "ok"]);
      expect(same[1]).toEqual(same[0]);
      expect(await countRows(EVENTS, [opId])).toBe(1);

      const other = randomUUID();
      const differ = await stampede([setNeeds(world, { studentId: fresh, opId: other, profiles: ["asd"] }), setNeeds(world, { studentId: fresh, opId: other, profiles: ["motor"] })]);
      expect(differ.map(describeOutcome).filter((text) => text !== "ok"), `other content, round ${round}`).toEqual([CONFLICT]);
    }
  });
});
