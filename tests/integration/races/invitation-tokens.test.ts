import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Session } from "../support/session";
import { countRows, openSession, readRows } from "../support/db";
import { waitUntilBlocked } from "../support/race";
import { createWorld } from "../support/world";

// F2C-39: a hash that an invitation ever had is never used again, not even with two connections. The registry
// app.invitation_tokens has a unique index; the AFTER trigger of invitations inserts every hash that is born or arrives
// and turns the unique_violation into P0004. Both isolation levels: the index waits for a concurrent transaction that
// inserted the same hash and reports the violation once that one commits, whatever the snapshot of the waiting one.

const LEVELS = ["read committed", "repeatable read"] as const;
const hex = () => createHash("sha256").update(randomUUID()).digest("hex");
const INSERT =
  "insert into app.invitations (institution_id, email, role, token_hash, expires_at) values ($1, $2, 'teacher', decode($3, 'hex'), now() + interval '7 days')";
const ROTATE = "update app.invitations set token_hash = decode($2, 'hex') where id = $1";

function errorCode(thrown: unknown): string {
  return typeof thrown === "object" && thrown !== null && typeof Reflect.get(thrown, "code") === "string" ? String(Reflect.get(thrown, "code")) : "unknown";
}

async function invitation(institutionId: string, tokenHash: string): Promise<string> {
  const rows = await readRows<{ id: string }>(`${INSERT} returning id`, [institutionId, `${randomUUID()}@correo-de-prueba.invalid`, tokenHash]);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("Falta la invitación de prueba.");
  return id;
}

const registered = (tokenHash: string) => countRows("select count(*) as n from app.invitation_tokens where token_hash = decode($1, 'hex')", [tokenHash]);
const holders = (tokenHash: string) => countRows("select count(*) as n from app.invitations where token_hash = decode($1, 'hex')", [tokenHash]);

type Pair = { first: Session; second: Session; observer: Session };

async function open(level: (typeof LEVELS)[number]): Promise<Pair> {
  const [first, second, observer] = await Promise.all([openSession(), openSession(), openSession()]);
  for (const session of [first, second]) {
    await session.rows(`begin isolation level ${level}`);
    await session.rows("select 1"); // the snapshot of a repeatable read starts here, before the other one commits
  }
  return { first, second, observer };
}

/** The first writer holds its transaction; the second one starts, waits, and only then does the first commit. */
async function held(pair: Pair, firstWrite: () => Promise<unknown>, secondWrite: () => Promise<unknown>): Promise<string | null> {
  await firstWrite();
  let done = false;
  const pending = secondWrite().then(
    () => null,
    (thrown: unknown) => errorCode(thrown),
  ).finally(() => {
    done = true;
  });
  const waitedOn = await waitUntilBlocked(pair.second, pair.observer, () => done);
  expect(waitedOn, "the second write waits for the first one").not.toBeNull();
  await pair.first.commit();
  const error = await pending;
  await (error === null ? pair.second.commit() : pair.second.rollback());
  return error;
}

async function close(pair: Pair) {
  await Promise.all([pair.first.close(), pair.second.close(), pair.observer.close()]);
}

describe.each(LEVELS)("race: the registry of invitation hashes (%s)", (level) => {
  it("a hash that a rotation vacated, taken by a new invitation while the rotation is uncommitted, is refused", async () => {
    const world = await createWorld();
    const old = hex();
    const rotated = await invitation(world.institutionId, old);
    const pair = await open(level);
    try {
      const error = await held(
        pair,
        () => pair.first.rows(ROTATE, [rotated, hex()]),
        () => pair.second.rows(INSERT, [world.institutionId, `${randomUUID()}@correo-de-prueba.invalid`, old]),
      );
      expect(error).toBe("P0004");
    } finally {
      await close(pair);
    }
    expect(await holders(old)).toBe(0);
    expect(await registered(old)).toBe(1);
  });

  it("the same, when the second one is another rotation that arrives at the vacated hash", async () => {
    const world = await createWorld();
    const old = hex();
    const [rotated, other] = [await invitation(world.institutionId, old), await invitation(world.institutionId, hex())];
    const pair = await open(level);
    try {
      const error = await held(
        pair,
        () => pair.first.rows(ROTATE, [rotated, hex()]),
        () => pair.second.rows(ROTATE, [other, old]),
      );
      expect(error).toBe("P0004");
    } finally {
      await close(pair);
    }
    expect(await holders(old)).toBe(0);
  });

  it("two transactions that insert the same new hash leave one invitation and one registry row", async () => {
    const world = await createWorld();
    const shared = hex();
    const pair = await open(level);
    let error: string | null;
    try {
      error = await held(
        pair,
        () => pair.first.rows(INSERT, [world.institutionId, `${randomUUID()}@correo-de-prueba.invalid`, shared]),
        () => pair.second.rows(INSERT, [world.institutionId, `${randomUUID()}@correo-de-prueba.invalid`, shared]),
      );
    } finally {
      await close(pair);
    }
    // The invitations table refuses it first (its own unique index) or the registry does (P0004): never both written.
    expect(["23505", "P0004"]).toContain(error);
    expect(await holders(shared)).toBe(1);
    expect(await registered(shared)).toBe(1);
  });

  it("a hash that arrives at an invitation while another rotation to it is uncommitted is refused too", async () => {
    const world = await createWorld();
    const target = hex();
    const [a, b] = [await invitation(world.institutionId, hex()), await invitation(world.institutionId, hex())];
    const pair = await open(level);
    let error: string | null;
    try {
      error = await held(
        pair,
        () => pair.first.rows(ROTATE, [a, target]),
        () => pair.second.rows(ROTATE, [b, target]),
      );
    } finally {
      await close(pair);
    }
    expect(["23505", "P0004"]).toContain(error);
    expect(await holders(target)).toBe(1);
    expect(await registered(target)).toBe(1);
  });
});
