import { describe, expect, it } from "vitest";
import { countRows, readRows } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome, idOf } from "../support/session";
import { createStudent, createWorld, teacherOf, type World } from "../support/world";

// (g) record_consent and revoke_consent at the same time for the same student (T1.3b). Consents are
// health-adjacent data: the tests use purposes and text versions only, never a name.

const GRANTED = "select count(*)::text as n from app.consents where student_id = $1 and purpose = $2 and status = 'granted'";
const ALL = "select count(*)::text as n from app.consents where student_id = $1 and purpose = $2";

function record(world: World, studentId: string, textVersion: string): Step {
  return {
    actor: teacherOf(world),
    rpc: "record_consent",
    args: { p_student_id: studentId, p_purpose: "ai_adaptation", p_text_version: textVersion },
  };
}

function revoke(world: World, consentId: string, revision: number): Step {
  return { actor: teacherOf(world), rpc: "revoke_consent", args: { p_consent_id: consentId, p_revision: revision } };
}

describe("race: consents of one student", () => {
  it("two records of the same purpose never leave two granted: the second waits for the first", async () => {
    const world = await createWorld();
    const student = await createStudent(world);
    const held = await heldRace(record(world, student, "v1"), record(world, student, "v2"));
    expect(held.first.ok).toBe(true);
    // The per-student consents lock is what made the second one wait.
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(idOf(held.second)).not.toBe(idOf(held.first));
    expect(await countRows(GRANTED, [student, "ai_adaptation"])).toBe(1);
    expect(await countRows(ALL, [student, "ai_adaptation"])).toBe(2);
  });

  it("the revocation and the new consent share an instant taken after the lock", async () => {
    const world = await createWorld();
    const student = await createStudent(world);
    const held = await heldRace(record(world, student, "v1"), record(world, student, "v2"));
    const rows = await readRows<{ id: string; status: string; fresh: boolean }>(
      `select c.id, c.status, (c.revoked_at is not null and c.revoked_at = n.valid_from and n.valid_from > c.valid_from) as fresh
         from app.consents c, app.consents n
        where c.student_id = $1 and n.id = $2 and c.id = $3`,
      [student, idOf(held.second), idOf(held.first)],
    );
    // The first consent was written before the second transaction got the lock; its revocation is
    // stamped with the clock of the second one after the wait (clock_timestamp), not with the start of
    // that transaction (now()), which would be earlier than the consent it revokes.
    expect(rows).toEqual([{ id: idOf(held.first), status: "revoked", fresh: true }]);
  });

  it("the same record at the same time answers one consent", async () => {
    const world = await createWorld();
    const student = await createStudent(world);
    const held = await heldRace(record(world, student, "v1"), record(world, student, "v1"));
    expect(held.waitedOn).toBe("advisory");
    expect(held.second).toEqual(held.first);
    expect(await countRows(ALL, [student, "ai_adaptation"])).toBe(1);
  });

  it("a revocation and a record at the same time leave one granted", async () => {
    const world = await createWorld();
    const student = await createStudent(world);
    const first = idOf((await heldRace(record(world, student, "v1"), record(world, student, "v1"))).first);
    const held = await heldRace(revoke(world, first, 1), record(world, student, "v2"));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(await countRows(GRANTED, [student, "ai_adaptation"])).toBe(1);
  });

  it("two different students do not wait for each other", async () => {
    const world = await createWorld();
    const [one, two] = [await createStudent(world), await createStudent(world)];
    const held = await heldRace(record(world, one, "v1"), record(world, two, "v1"));
    expect(held.waitedOn).toBeNull();
    expect(held.second.ok).toBe(true);
  });

  it("holds when many run at once, 15 times", async () => {
    const world = await createWorld();
    const students = await Promise.all(Array.from({ length: 15 }, () => createStudent(world)));
    for (const [round, student] of students.entries()) {
      const outcomes = await stampede([record(world, student, "v1"), record(world, student, "v2"), record(world, student, "v3")]);
      expect(outcomes.map(describeOutcome), `round ${round}`).toEqual(["ok", "ok", "ok"]);
      expect(await countRows(GRANTED, [student, "ai_adaptation"]), `round ${round}`).toBe(1);
      expect(await countRows(ALL, [student, "ai_adaptation"]), `round ${round}`).toBe(3);
    }
  });
});
