import { describe, expect, it } from "vitest";
import { countRows, readRows } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome, idOf } from "../support/session";
import { studentAccount } from "../support/accounts";
import { addMembership, createPerson, createStudent, createWorld, SERVICE } from "../support/world";

// W1-6 (a) and W1-3 (b): the person who is staff and student at once, and add against revoke. The account of the student is the
// canonical one of phase 2 (remembered in his provisioning row), the only kind that can be linked to a student.

const ROLE_CONFLICT = "P0001 CONFLICT role_conflict";
const ACTIVE_STAFF =
  "select count(*)::text as n from app.memberships where institution_id = $1 and user_id = $2 and revoked_at is null and role <> 'student'";
const STUDENT_ROWS = "select count(*)::text as n from app.students where institution_id = $1 and user_id = $2";

function addStaff(institutionId: string, userId: string): Step {
  return { actor: SERVICE, rpc: "internal_add_membership", args: { p_institution_id: institutionId, p_user_id: userId, p_role: "teacher" } };
}
function link(studentId: string, userId: string): Step {
  return { actor: SERVICE, rpc: "internal_link_student_user", args: { p_student_id: studentId, p_user_id: userId } };
}

async function staffAndStudentRows(institutionId: string, userId: string): Promise<[number, number]> {
  return [await countRows(ACTIVE_STAFF, [institutionId, userId]), await countRows(STUDENT_ROWS, [institutionId, userId])];
}

describe("race: a person is never staff and student in the same institution", () => {
  it.each(["staff first", "link first"] as const)("one wins and the other is CONFLICT role_conflict (%s)", async (order) => {
    const world = await createWorld();
    const student = await createStudent(world);
    const person = await studentAccount(student);
    const staff = addStaff(world.institutionId, person);
    const tie = link(student, person);
    const held = order === "staff first" ? await heldRace(staff, tie) : await heldRace(tie, staff);

    expect(held.first.ok).toBe(true);
    expect(describeOutcome(held.second)).toBe(ROLE_CONFLICT);
    expect(held.waitedOn, "the second call must wait for the first one's lock").toBe("advisory");
    const [staffRows, studentRows] = await staffAndStudentRows(world.institutionId, person);
    expect(staffRows + studentRows).toBe(1);
  });

  it("holds when both run at once, 20 times", async () => {
    const world = await createWorld();
    const students = await Promise.all(Array.from({ length: 20 }, () => createStudent(world)));
    const people = await Promise.all(students.map((student) => studentAccount(student)));
    for (const [index, person] of people.entries()) {
      const outcomes = await stampede([addStaff(world.institutionId, person), link(students[index] ?? "", person)]);
      const failed = outcomes.filter((outcome) => !outcome.ok).map(describeOutcome);
      expect(failed, `iteration ${index}`).toEqual([ROLE_CONFLICT]);
      const [staffRows, studentRows] = await staffAndStudentRows(world.institutionId, person);
      expect(staffRows * studentRows, `iteration ${index}: both exist`).toBe(0);
    }
  });
});

describe("race: adding a membership again against revoking it", () => {
  async function member() {
    const world = await createWorld();
    const person = await createPerson();
    const membershipId = idOf(await addMembership(world.institutionId, person, "teacher"));
    const revoke: Step = { actor: SERVICE, rpc: "internal_revoke_membership", args: { p_membership_id: membershipId } };
    return { world, person, membershipId, revoke, add: addStaff(world.institutionId, person) };
  }
  const activeRows = "select id from app.memberships where institution_id = $1 and user_id = $2 and role = 'teacher' and revoked_at is null";
  const select = (institutionId: string, person: string) => readRows<{ id: string }>(activeRows, [institutionId, person]);

  it("an add that finds the membership revoked answers a new one, never a null id", async () => {
    const { world, person, membershipId, revoke, add } = await member();
    const held = await heldRace(revoke, add);
    expect(held.waitedOn).toBe("advisory");
    const newId = idOf(held.second);
    expect(newId).not.toBe(membershipId);
    expect((await select(world.institutionId, person)).map((row) => row.id)).toEqual([newId]);
  });

  it("a revoke that arrives after an add leaves the person without the membership", async () => {
    const { world, person, membershipId, revoke, add } = await member();
    const held = await heldRace(add, revoke);
    expect(held.waitedOn).toBe("advisory");
    expect(idOf(held.first)).toBe(membershipId);
    expect(idOf(held.second)).toBe(membershipId);
    expect(await select(world.institutionId, person)).toEqual([]);
  });

  it("never answers a null id or an unexpected error, 20 times", async () => {
    const { world, person, revoke, add } = await member();
    for (let round = 0; round < 20; round += 1) {
      const outcomes = await stampede([add, revoke, add, add]);
      for (const outcome of outcomes) expect(describeOutcome(outcome), `round ${round}`).toBe("ok");
      expect(outcomes.map((outcome) => typeof idOf(outcome))).toEqual(Array(4).fill("string"));
      expect((await select(world.institutionId, person)).length).toBeLessThanOrEqual(1);
      await addMembership(world.institutionId, person, "teacher");
    }
  });
});
