import { describe, expect, it } from "vitest";
import { countRows } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome } from "../support/session";
import { studentAccount } from "../support/accounts";
import { createStudent, createWorld, SERVICE } from "../support/world";

// W2-4 (d): two students cannot take the same Auth account, in one institution or across two.
// The account is the canonical one of the first student (remembered in his provisioning row: student_auth_link_guard lets no other
// kind through), so the first student is the one that wins; the race is still the two links at once, and the other one is refused
// with CONFLICT behind the lock of the account, never a raw 23505.

const CONFLICT = "P0001 CONFLICT op_key_reused";
const TIED = "select count(*)::text as n from app.students where user_id = $1";

function link(studentId: string, userId: string): Step {
  return { actor: SERVICE, rpc: "internal_link_student_user", args: { p_student_id: studentId, p_user_id: userId } };
}

describe("race: two students and one account", () => {
  it("in the same institution: one links, the other is CONFLICT, never a raw 23505", async () => {
    const world = await createWorld();
    const [one, two] = [await createStudent(world), await createStudent(world)];
    const person = await studentAccount(one);
    const held = await heldRace(link(one, person), link(two, person));
    expect(held.first.ok).toBe(true);
    expect(describeOutcome(held.second)).toBe(CONFLICT);
    // The account lock, not the unique index, made the second one wait.
    expect(held.waitedOn).toBe("advisory");
    expect(await countRows(TIED, [person])).toBe(1);
  });

  it("across two institutions: the lock is by account alone", async () => {
    const [worldA, worldB] = [await createWorld(), await createWorld()];
    expect(worldA.institutionId).not.toBe(worldB.institutionId);
    const [one, two] = [await createStudent(worldA), await createStudent(worldB)];
    const person = await studentAccount(one);
    const held = await heldRace(link(one, person), link(two, person));
    expect(held.first.ok).toBe(true);
    expect(describeOutcome(held.second)).toBe(CONFLICT);
    expect(held.waitedOn).toBe("advisory");
    expect(await countRows(TIED, [person])).toBe(1);
  });

  it("holds when both run at once, 15 times", async () => {
    const world = await createWorld();
    const pairs = await Promise.all(Array.from({ length: 15 }, async () => [await createStudent(world), await createStudent(world)] as const));
    const people = await Promise.all(pairs.map(([one]) => studentAccount(one)));
    for (const [index, person] of people.entries()) {
      const [one, two] = pairs[index] ?? ["", ""];
      const outcomes = await stampede([link(one, person), link(two, person)]);
      expect(outcomes.filter((outcome) => !outcome.ok).map(describeOutcome), `iteration ${index}`).toEqual([CONFLICT]);
      expect(await countRows(TIED, [person]), `iteration ${index}`).toBe(1);
    }
  });
});
