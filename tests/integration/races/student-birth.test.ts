import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Session } from "../support/session";
import { openSession, readRows } from "../support/db";
import { waitUntilBlocked } from "../support/race";
import { createStudent, createWorld } from "../support/world";

// F2C-54: an account whose id is remembered in a deleted provisioning row is not born again. The erasure marks the row deleted
// (it holds the row lock until it commits) and only then deletes the account of Auth; a late creation (the INSERT in
// auth.users) waits for that lock through FOR SHARE in app.student_auth_birth_guard and then reads the committed state.

const MARK = "update app.account_provisioning set status = 'deleted', revision = revision + 1 where student_id = $1";
const BORN = "insert into auth.users (id, email) values ($1, $2)";
const LEVELS = ["read committed", "repeatable read"] as const;

function errorCode(thrown: unknown): string {
  return typeof thrown === "object" && thrown !== null && typeof Reflect.get(thrown, "code") === "string" ? String(Reflect.get(thrown, "code")) : "unknown";
}

async function rememberedStudent(): Promise<{ studentId: string; authUserId: string }> {
  const world = await createWorld();
  const studentId = await createStudent(world);
  const authUserId = randomUUID();
  await readRows("update app.account_provisioning set auth_user_id = $2 where student_id = $1", [studentId, authUserId]);
  return { studentId, authUserId };
}

type Pair = { erasure: Session; creation: Session; observer: Session };

async function open(level: (typeof LEVELS)[number]): Promise<Pair> {
  const [erasure, creation, observer] = await Promise.all([openSession(), openSession(), openSession()]);
  await erasure.rows("begin");
  await creation.rows(`begin isolation level ${level}`);
  await creation.rows("select 1"); // the snapshot of a repeatable read starts before the erasure commits
  return { erasure, creation, observer };
}

async function close(pair: Pair) {
  await Promise.all([pair.erasure.close(), pair.creation.close(), pair.observer.close()]);
}

const exists = async (id: string) => (await readRows<{ n: string }>("select count(*) as n from auth.users where id = $1", [id]))[0]?.n === "1";

describe.each(LEVELS)("race: a creation in Auth against an erasure in progress (%s)", (level) => {
  it("the creation waits for the erasure and, once it commits, is refused", async () => {
    const { studentId, authUserId } = await rememberedStudent();
    const pair = await open(level);
    let error: string | null;
    try {
      await pair.erasure.rows(MARK, [studentId]);
      let done = false;
      const pending = pair.creation.rows(BORN, [authUserId, `${authUserId}@estudiantes.usetiza.app`]).then(
        () => null,
        (thrown: unknown) => errorCode(thrown),
      ).finally(() => {
        done = true;
      });
      const waitedOn = await waitUntilBlocked(pair.creation, pair.observer, () => done);
      expect(waitedOn, "the creation waits for the erasure").not.toBeNull();
      await pair.erasure.rows("commit");
      error = await pending;
      await pair.creation.rows("rollback");
    } finally {
      await close(pair);
    }
    // Read committed reads the committed state: P0004. Repeatable read cannot lock a row changed after its snapshot: a
    // serialization failure. Either way the account is not born.
    expect(["P0004", "40001"]).toContain(error);
    if (level === "read committed") expect(error).toBe("P0004");
    expect(await exists(authUserId)).toBe(false);
  });

  it("if the erasure rolls back, the creation goes through (in repeatable read the guard refuses with 40001 before anything)", async () => {
    const { studentId, authUserId } = await rememberedStudent();
    const pair = await open(level);
    let error: string | null = null;
    try {
      await pair.erasure.rows(MARK, [studentId]);
      let done = false;
      const pending = pair.creation.rows(BORN, [authUserId, `${authUserId}@estudiantes.usetiza.app`]).then(
        () => null,
        (thrown: unknown) => errorCode(thrown),
      ).finally(() => {
        done = true;
      });
      if (level === "read committed") {
        const waitedOn = await waitUntilBlocked(pair.creation, pair.observer, () => done);
        expect(waitedOn, "the creation waits for the erasure").not.toBeNull();
      }
      await pair.erasure.rows("rollback");
      error = await pending;
      await pair.creation.rows(error === null ? "commit" : "rollback");
    } finally {
      await close(pair);
    }
    expect(error).toBe(level === "read committed" ? null : "40001");
    expect(await exists(authUserId)).toBe(level === "read committed");
  });
});
