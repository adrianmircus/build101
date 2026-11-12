import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSession, readRows } from "../support/db";
import { waitUntilBlocked } from "../support/race";

// F2C-67: the triggers on auth.users take the same advisory lock on the id first (app.student_auth_lock), and refuse (40001)
// outside READ COMMITTED, where the next query would not see what the other end committed.

const BORN = "insert into auth.users (id, email) values ($1, $2)";

function errorCode(thrown: unknown): string {
  return typeof thrown === "object" && thrown !== null && typeof Reflect.get(thrown, "code") === "string" ? String(Reflect.get(thrown, "code")) : "unknown";
}

describe("race: the advisory lock on the id of an account of Auth", () => {
  it("in REPEATABLE READ the write is refused with 40001", async () => {
    const session = await openSession();
    try {
      await session.rows("begin isolation level repeatable read");
      await session.rows("select 1");
      const error = await session.rows(BORN, [randomUUID(), `${randomUUID()}@tiza-test.example`]).then(
        () => null,
        (thrown: unknown) => errorCode(thrown),
      );
      expect(error).toBe("40001");
      await session.rows("rollback");
    } finally {
      await session.close();
    }
  });

  it("two writes of the same id in READ COMMITTED run one after the other: the second waits on the advisory lock", async () => {
    const id = randomUUID();
    const [first, second, observer] = await Promise.all([openSession(), openSession(), openSession()]);
    try {
      await first.rows("begin");
      await first.rows(BORN, [id, `${randomUUID()}@tiza-test.example`]);
      await second.rows("begin");
      let done = false;
      const pending = second.rows(BORN, [id, `${randomUUID()}@tiza-test.example`]).then(
        () => null,
        (thrown: unknown) => errorCode(thrown),
      ).finally(() => {
        done = true;
      });
      const waitedOn = await waitUntilBlocked(second, observer, () => done);
      expect(waitedOn).toBe("advisory");
      await first.rows("commit");
      expect(await pending).toBe("23505");
      await second.rows("rollback");
    } finally {
      await Promise.all([first.close(), second.close(), observer.close()]);
    }
    expect((await readRows<{ n: string }>("select count(*) as n from auth.users where id = $1", [id]))[0]?.n).toBe("1");
  });

  // The two orders between an INSERT in Auth with a password and another transaction that remembers the same id need the trigger of
  // account_provisioning (BEFORE INSERT OR UPDATE OF auth_user_id), which is BLOQUEADO in the contract files: see the notes.
  it.todo("an INSERT in Auth with a password while another transaction remembers the id: the second one waits and refuses");
  it.todo("the other order: remembering the id while an INSERT of a row with a password is in progress");
});
