import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { countRows } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome, idOf } from "../support/session";
import { createStudent, createWorld, teacherOf, type World } from "../support/world";

// create_student_note twice with the same op_key (T1.F2). Notes are health-adjacent data: the tests
// use placeholder text only, never a name.

const NOTES = "select count(*)::text as n from app.student_notes where student_id = $1";

function note(world: World, studentId: string, content: { body: string; opKey: string }): Step {
  return { actor: teacherOf(world), rpc: "create_student_note", args: { p_student_id: studentId, p_body: content.body, p_op_key: content.opKey } };
}

describe("race: create_student_note with the same op_key", () => {
  it("the second waits for the first and answers the same note", async () => {
    const world = await createWorld();
    const student = await createStudent(world);
    const key = randomUUID();
    const held = await heldRace(note(world, student, { body: "Observación", opKey: key }), note(world, student, { body: "Observación", opKey: key }));
    expect(held.first.ok).toBe(true);
    // The lock of (author, op_key) is what made the second one wait. Without it the second call does
    // not block, reads no note (the first is not committed) and creates a second one.
    expect(held.waitedOn).toBe("advisory");
    expect(held.second).toEqual(held.first);
    expect(await countRows(NOTES, [student])).toBe(1);
  });

  it("the same op_key for another text waits and is CONFLICT op_key_reused", async () => {
    const world = await createWorld();
    const student = await createStudent(world);
    const key = randomUUID();
    const held = await heldRace(note(world, student, { body: "Observación", opKey: key }), note(world, student, { body: "Otra observación", opKey: key }));
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toContain("op_key_reused");
    expect(await countRows(NOTES, [student])).toBe(1);
  });

  it("six submits at once create one note, 10 times", async () => {
    const world = await createWorld();
    const student = await createStudent(world);
    for (let round = 0; round < 10; round += 1) {
      const key = randomUUID();
      const outcomes = await stampede(Array.from({ length: 6 }, () => note(world, student, { body: `Observación ${round}`, opKey: key })));
      expect(outcomes.map(describeOutcome), `round ${round}`).toEqual(Array(6).fill("ok"));
      expect(new Set(outcomes.map(idOf)).size, `round ${round}`).toBe(1);
    }
    expect(await countRows(NOTES, [student])).toBe(10);
  });
});
