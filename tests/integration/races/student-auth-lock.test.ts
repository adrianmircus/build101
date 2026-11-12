import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Session } from "../support/session";
import { openSession, readRows } from "../support/db";
import { waitUntilBlocked } from "../support/race";
import { createStudent, createWorld } from "../support/world";

// F2C-67: the triggers on auth.users take the same advisory lock on the id first (app.student_auth_lock), and refuse (40001)
// outside READ COMMITTED, where the next query would not see what the other end committed.

// The tests that need the shape guard of account_provisioning run only with TIZA_LINK_GUARD=1 (the default run turns it off for phase 1).
const GUARD = process.env.TIZA_LINK_GUARD === "1";
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

  // The two ends of the relation (F2C-67, F2C-70): the row of account_provisioning first and the advisory lock after, on both sides.
  const REMEMBER = "update app.account_provisioning set auth_user_id = $2 where student_id = $1";
  const TRIVIAL = "update app.account_provisioning set auth_user_id = auth_user_id where student_id = $1";

  async function student() {
    const world = await createWorld();
    return createStudent(world);
  }

  async function heldPair(first: (a: Session) => Promise<unknown>, second: (b: Session) => Promise<unknown>) {
    const [a, b, observer] = await Promise.all([openSession(), openSession(), openSession()]);
    try {
      await Promise.all([a.rows("begin"), b.rows("begin")]);
      await first(a);
      let done = false;
      const pending = second(b).then(
        () => null,
        (thrown: unknown) => errorCode(thrown),
      ).finally(() => {
        done = true;
      });
      const waitedOn = await waitUntilBlocked(b, observer, () => done);
      await a.rows("commit");
      const error = await pending;
      await b.rows(error === null ? "commit" : "rollback");
      return { waitedOn, error };
    } finally {
      await Promise.all([a.close(), b.close(), observer.close()]);
    }
  }

  const stored = async (id: string) => (await readRows<{ n: string; hash: string | null }>("select count(*) over () as n, encrypted_password as hash from auth.users where id = $1", [id]))[0];

  it.skipIf(!GUARD)("an INSERT in Auth with a password while another transaction remembers the id: it waits for the row, then the password is erased", async () => {
    const created = await student();
    const id = randomUUID();
    const { waitedOn, error } = await heldPair(
      (remembering) => remembering.rows(REMEMBER, [created, id]),
      (inserting) => inserting.rows("insert into auth.users (id, email, encrypted_password) values ($1, $2, 'hash-of-createUser')", [id, `${id}@estudiantes.usetiza.app`]),
    );
    expect(waitedOn).not.toBeNull();
    expect(error).toBeNull();
    expect((await stored(id))?.hash).toBeNull();
  });

  it.skipIf(!GUARD)("the other order: remembering the id while an INSERT of an account with a password and another email is in progress is refused", async () => {
    const created = await student();
    const id = randomUUID();
    const { waitedOn, error } = await heldPair(
      (inserting) => inserting.rows("insert into auth.users (id, email, encrypted_password) values ($1, $2, 'a-real-password-hash')", [id, `${randomUUID()}@tiza-test.example`]),
      (remembering) => remembering.rows(REMEMBER, [created, id]),
    );
    expect(waitedOn).not.toBeNull();
    expect(error).toBe("P0004");
    expect((await readRows<{ a: string | null }>("select auth_user_id::text as a from app.account_provisioning where student_id = $1", [created]))[0]?.a).toBeNull();
  });

  it.skipIf(!GUARD)("an INSERT in Auth of a remembered id and a trivial UPDATE of its provisioning row finish without a deadlock, in either order", async () => {
    for (const insertFirst of [true, false]) {
      const created = await student();
      const id = randomUUID();
      await readRows(REMEMBER, [created, id]);
      const insert = (session: Session) => session.rows("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@estudiantes.usetiza.app`]);
      const trivial = (session: Session) => session.rows(TRIVIAL, [created]);
      const { error } = await heldPair(insertFirst ? insert : trivial, insertFirst ? trivial : insert);
      expect(error, insertFirst ? "insert then update" : "update then insert").toBeNull();
      expect((await stored(id))?.n).toBe("1");
    }
  });

  it.skipIf(!GUARD)("three connections: B remembers the id, A inserts it in Auth and waits, C marks the row deleted and waits for A; the account of Auth is there to be deleted (F2C-67, F2C-75)", async () => {
    const created = await student();
    const id = randomUUID();
    const [a, b, c, observer] = await Promise.all([openSession(), openSession(), openSession(), openSession()]);
    try {
      await Promise.all([a.rows("begin"), b.rows("begin"), c.rows("begin")]);
      await b.rows(REMEMBER, [created, id]);

      let aDone = false;
      const inserting = a.rows(BORN, [id, `${id}@estudiantes.usetiza.app`]).finally(() => {
        aDone = true;
      });
      expect(await waitUntilBlocked(a, observer, () => aDone), "A waits for the row that B holds").not.toBeNull();
      await b.rows("commit");
      await inserting;

      let cDone = false;
      const marking = c.rows("update app.account_provisioning set status = 'deleted', revision = revision + 1 where student_id = $1", [created]).finally(() => {
        cDone = true;
      });
      expect(await waitUntilBlocked(c, observer, () => cDone), "C waits for A, which still holds the row").not.toBeNull();
      await a.rows("commit");
      await marking;
      await c.rows("commit");
    } finally {
      await Promise.all([a.close(), b.close(), c.close(), observer.close()]);
    }
    expect((await readRows<{ s: string }>("select status as s from app.account_provisioning where student_id = $1", [created]))[0]?.s).toBe("deleted");
    expect((await stored(id))?.n).toBe("1");
  });
});

