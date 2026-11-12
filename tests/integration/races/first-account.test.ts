import { describe, expect, it } from "vitest";
import { openSession, readRows } from "../support/db";
import { waitUntilBlocked } from "../support/race";
import { createPerson, createStudent, createWorld } from "../support/world";

// T1.F15 (F1-4, round 8): two direct writers of the first account of a student, at once. One links the student to A,
// the other writes B in its provisioning row. Whatever the order, the student never ends linked to one account while
// its provisioning row remembers another: the second writer waits for the first one's lock and is refused.

const LINK = "update app.students set user_id = $2 where id = $1";
const REMEMBER = "update app.account_provisioning set auth_user_id = $2 where student_id = $1";
const STATE =
  "select s.user_id::text as linked, ap.auth_user_id::text as remembered from app.students s join app.account_provisioning ap on ap.student_id = s.id where s.id = $1";

type Write = { sql: string; values: string[] };
type Held = { waitedOn: string | null; secondError: string | null };

function errorCode(thrown: unknown): string {
  return typeof thrown === "object" && thrown !== null && typeof Reflect.get(thrown, "code") === "string"
    ? String(Reflect.get(thrown, "code"))
    : "unknown";
}

/** The first write commits after the second one is blocked on its lock; returns what the second one waited on and its error. */
async function heldWrites(first: Write, second: Write): Promise<Held> {
  const [a, b, observer] = await Promise.all([openSession(), openSession(), openSession()]);
  try {
    await Promise.all([a.beginAsOwner(), b.beginAsOwner()]);
    await a.rows(first.sql, first.values);
    let done = false;
    const pending = b.rows(second.sql, second.values).then(
      () => null,
      (thrown: unknown) => errorCode(thrown),
    ).finally(() => {
      done = true;
    });
    const waitedOn = await waitUntilBlocked(b, observer, () => done);
    await a.commit();
    const secondError = await pending;
    await (secondError ? b.rollback() : b.commit());
    return { waitedOn, secondError };
  } finally {
    await Promise.all([a.close(), b.close(), observer.close()]);
  }
}

async function unlinkedStudent() {
  const world = await createWorld();
  const [student, accountA, accountB] = await Promise.all([createStudent(world), createPerson(), createPerson()]);
  return { student, accountA, accountB };
}

async function stateOf(student: string) {
  return (await readRows<{ linked: string | null; remembered: string | null }>(STATE, [student]))[0];
}

describe("race: the first account of a student", () => {
  it("a link that arrives while another account is being remembered waits and is refused", async () => {
    const { student, accountA, accountB } = await unlinkedStudent();
    const held = await heldWrites({ sql: REMEMBER, values: [student, accountB] }, { sql: LINK, values: [student, accountA] });
    // Without the FOR UPDATE the link reads NULL, goes ahead and records nothing: linked to A, remembering B.
    expect(held.waitedOn, "the link must wait for the provisioning row's lock").not.toBeNull();
    expect(held.secondError).toBe("P0004");
    expect(await stateOf(student)).toEqual({ linked: null, remembered: accountB });
  });

  it("an account written while the link is open waits and is refused", async () => {
    const { student, accountA, accountB } = await unlinkedStudent();
    const held = await heldWrites({ sql: LINK, values: [student, accountA] }, { sql: REMEMBER, values: [student, accountB] });
    expect(held.waitedOn, "the write must wait for the link's lock").not.toBeNull();
    expect(held.secondError).toBe("P0004");
    expect(await stateOf(student)).toEqual({ linked: accountA, remembered: accountA });
  });
});
