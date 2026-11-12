import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalEmail, pendingStudent } from "../support/accounts";
import { countRows, openSession, readRows, runRpc } from "../support/db";
import { heldPair, heldRace, pgCode, waitUntilBlocked } from "../support/race";
import { describeOutcome } from "../support/session";
import { createWorld, SERVICE } from "../support/world";

// T2.5a, «Aprovisionar una cuenta de estudiante» y «Las dos puntas de la relación» (F2C-67, F2C-70, F2C-71, F2C-74): the RPCs of the
// provisioning take their locks in the order student -> row of account_provisioning FOR UPDATE -> advisory lock of the Auth id, the
// same order of the triggers of auth.users and of account_provisioning (the row first, the advisory lock after), so none of them
// can close a cycle with the others, and an account that appears in the middle is answered ok false, not P0004.

const remember = (provisioningId: string, authUserId: string) => ({
  actor: SERVICE,
  rpc: "internal_remember_student_account",
  args: { p_provisioning_id: provisioningId, p_auth_user_id: authUserId },
});

const rememberCall = (provisioningId: string, authUserId: string) => ({
  actor: SERVICE,
  run: (session: Awaited<ReturnType<typeof openSession>>) =>
    session.call("internal_remember_student_account", { p_provisioning_id: provisioningId, p_auth_user_id: authUserId }),
});

const BORN = "insert into auth.users (id, email) values ($1, $2)";
const MARK_DELETED = "update app.account_provisioning set status = 'deleted', revision = revision + 1 where id = $1";

const stored = async (provisioningId: string) =>
  (await readRows<{ id: string | null; status: string; attempts: number }>("select auth_user_id::text as id, status, attempts from app.account_provisioning where id = $1", [provisioningId]))[0];
const accounts = (authUserId: string) => countRows("select count(*) as n from auth.users where id = $1", [authUserId]);

describe("race: remembering the id of the account of a student", () => {
  it("two calls with different ids at once converge on one: the second waits and gets the id of the first", async () => {
    const world = await createWorld();
    const { provisioningId } = await pendingStudent(world);
    const [idA, idB] = [randomUUID(), randomUUID()];
    const held = await heldRace(remember(provisioningId, idA), remember(provisioningId, idB));
    // Without the locks the second one reads NULL and writes idB over idA (the guard of auth_user_id would answer P0004 instead of ok).
    expect(held.waitedOn, "the second call waits for the row").not.toBeNull();
    expect(held.first).toEqual({ ok: true, value: { ok: true, authUserId: idA } });
    expect(held.second).toEqual({ ok: true, value: { ok: true, authUserId: idA } });
    expect((await stored(provisioningId))?.id).toBe(idA);
  });

  it("two students asking for the same id: the second waits on the advisory lock and answers ok false", async () => {
    const world = await createWorld();
    const [one, two] = [await pendingStudent(world), await pendingStudent(world)];
    const id = randomUUID();
    const held = await heldRace(remember(one.provisioningId, id), remember(two.provisioningId, id));
    expect(held.waitedOn).toBe("advisory");
    expect(held.first).toEqual({ ok: true, value: { ok: true, authUserId: id } });
    expect(held.second).toEqual({ ok: true, value: { ok: false } });
    expect((await stored(two.provisioningId))?.id).toBeNull();
  });

  it("an erasure that marks the row deleted first: the call waits for the row and answers ok false", async () => {
    const world = await createWorld();
    const { provisioningId } = await pendingStudent(world);
    const held = await heldPair(
      { actor: "owner", run: (session) => session.rows(MARK_DELETED, [provisioningId]) },
      rememberCall(provisioningId, randomUUID()),
    );
    expect(held.waitedOn, "the call waits for the mark").not.toBeNull();
    expect(held.second).toEqual({ ok: true, value: { ok: true, value: { ok: false } } });
    const row = await stored(provisioningId);
    expect(row).toMatchObject({ id: null, status: "deleted" });
  });

  it("an incompatible account that appears in the middle (an INSERT in Auth that has not committed) gives ok false, not P0004", async () => {
    const world = await createWorld();
    const { provisioningId } = await pendingStudent(world);
    const id = randomUUID();
    const held = await heldPair(
      { actor: "owner", run: (session) => session.rows("insert into auth.users (id, email, encrypted_password) values ($1, $2, 'a-real-hash')", [id, `${randomUUID()}@tiza-test.example`]) },
      rememberCall(provisioningId, id),
    );
    expect(held.waitedOn, "the call waits on the advisory lock of the id that the INSERT holds").toBe("advisory");
    expect(held.second).toEqual({ ok: true, value: { ok: true, value: { ok: false } } });
    expect((await stored(provisioningId))?.id).toBeNull();
  });

  it("order of the locks: while the student is held, the call waits for him before it touches the row of account_provisioning", async () => {
    const world = await createWorld();
    const { studentId, provisioningId } = await pendingStudent(world);
    const [holder, calling, observer, probe] = await Promise.all([openSession(), openSession(), openSession(), openSession()]);
    try {
      await holder.beginAsOwner();
      await holder.rows("select id from app.students where id = $1 for update", [studentId]);
      await calling.begin(SERVICE);
      let done = false;
      const pending = calling.call("internal_remember_student_account", { p_provisioning_id: provisioningId, p_auth_user_id: randomUUID() }).finally(() => {
        done = true;
      });
      expect(await waitUntilBlocked(calling, observer, () => done), "waits for the row of the student").not.toBeNull();
      // With the order of the contract (student first) the row of account_provisioning is still free; if the call had taken it first this would fail with 55P03.
      await probe.beginAsOwner();
      await probe.rows("select 1 from app.account_provisioning where id = $1 for update nowait", [provisioningId]);
      await probe.rollback();
      await holder.commit();
      expect(describeOutcome(await pending)).toBe("ok");
      await calling.commit();
    } finally {
      await Promise.all([holder.close(), calling.close(), observer.close(), probe.close()]);
    }
  });

  it("fail and remember on the same row, one after the other, never end in a deadlock", async () => {
    const world = await createWorld();
    const { provisioningId } = await pendingStudent(world);
    const id = randomUUID();
    const held = await heldRace(remember(provisioningId, id), {
      actor: SERVICE,
      rpc: "internal_fail_student_account",
      args: { p_provisioning_id: provisioningId, p_error_code: "auth_down" },
    });
    expect(held.waitedOn).not.toBeNull();
    expect(held.second).toEqual({ ok: true, value: { status: "failed", attempts: 1 } });
    expect(await stored(provisioningId)).toEqual({ id, status: "failed", attempts: 1 });
  });

  it("two fails at once count both attempts", async () => {
    const world = await createWorld();
    const { provisioningId } = await pendingStudent(world);
    const fail = { actor: SERVICE, rpc: "internal_fail_student_account", args: { p_provisioning_id: provisioningId, p_error_code: "auth_down" } };
    const held = await heldRace(fail, fail);
    expect(held.waitedOn).not.toBeNull();
    expect(await stored(provisioningId)).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("fail that arrives while the account is being linked does not undo it: it waits, sees active and changes nothing", async () => {
    const world = await createWorld();
    const { studentId, provisioningId } = await pendingStudent(world);
    const id = randomUUID();
    expect(describeOutcome(await runRpc(SERVICE, "internal_remember_student_account", { p_provisioning_id: provisioningId, p_auth_user_id: id }))).toBe("ok");
    await readRows(BORN, [id, canonicalEmail(id)]);
    await runRpc(SERVICE, "internal_upsert_app_user", { p_user_id: id, p_display_name: "Cuenta de estudiante" });
    const held = await heldRace(
      { actor: SERVICE, rpc: "internal_link_student_user", args: { p_student_id: studentId, p_user_id: id } },
      { actor: SERVICE, rpc: "internal_fail_student_account", args: { p_provisioning_id: provisioningId, p_error_code: "late_process" } },
    );
    expect(held.waitedOn).not.toBeNull();
    expect(held.second).toEqual({ ok: true, value: { status: "active", attempts: 0 } });
    expect(await stored(provisioningId)).toEqual({ id, status: "active", attempts: 0 });
  });
});

describe("race: an INSERT in Auth against an erasure, with two and with three connections", () => {
  async function rememberedStudent() {
    const world = await createWorld();
    const { provisioningId } = await pendingStudent(world);
    const id = randomUUID();
    expect(describeOutcome(await runRpc(SERVICE, "internal_remember_student_account", { p_provisioning_id: provisioningId, p_auth_user_id: id }))).toBe("ok");
    return { provisioningId, id };
  }

  it("an INSERT that waits for an erasure in progress sees it once it commits: P0004, and no account is born", async () => {
    const { provisioningId, id } = await rememberedStudent();
    const held = await heldPair(
      { actor: "owner", run: (session) => session.rows(MARK_DELETED, [provisioningId]) },
      { actor: "owner", run: (session) => session.rows(BORN, [id, canonicalEmail(id)]) },
    );
    // Without the FOR SHARE on the row, the INSERT reads «not deleted yet», is born, and the erasure marks a row whose account lives.
    expect(held.waitedOn, "the INSERT waits for the erasure").not.toBeNull();
    expect(held.second).toEqual({ ok: false, code: "P0004" });
    expect(await accounts(id)).toBe(0);
    expect((await stored(provisioningId))?.status).toBe("deleted");
  });

  it("three connections (F2C-74): B remembers the id, A inserts it in Auth, C marks the row deleted; whatever order they run in, no account is left alive and nothing deadlocks", async () => {
    const world = await createWorld();
    const { provisioningId } = await pendingStudent(world);
    const id = randomUUID();
    const [a, b, c, observer] = await Promise.all([openSession(), openSession(), openSession(), openSession()]);
    try {
      await Promise.all([a.beginAsOwner(), b.begin(SERVICE), c.beginAsOwner()]);
      expect(describeOutcome(await b.call("internal_remember_student_account", { p_provisioning_id: provisioningId, p_auth_user_id: id }))).toBe("ok");

      let aDone = false;
      let cDone = false;
      const inserting = a.rows(BORN, [id, canonicalEmail(id)]).then(() => null, pgCode).finally(() => { aDone = true; });
      expect(await waitUntilBlocked(a, observer, () => aDone), "A waits for the row that B holds").not.toBeNull();
      const marking = c.rows(MARK_DELETED, [provisioningId]).then(() => null, pgCode).finally(() => { cDone = true; });
      expect(await waitUntilBlocked(c, observer, () => cDone), "C waits for the row that B holds").not.toBeNull();
      await b.commit();

      // Whoever gets the row first goes ahead; the other one waits for it (A needs the row FOR SHARE, C needs it to update).
      const winner = await Promise.race([inserting.then(() => "a" as const), marking.then(() => "c" as const)]);
      const [winnerSession, loserSession] = winner === "a" ? [a, c] : [c, a];
      await winnerSession.commit();
      const [aError, cError] = await Promise.all([inserting, marking]);
      await loserSession.commit().catch(() => undefined);
      expect(aError === "40P01" || cError === "40P01", "no deadlock").toBe(false);
      expect(cError, "the mark is never refused").toBeNull();
      expect([null, "P0004"]).toContain(aError);
    } finally {
      await Promise.all([a.close(), b.close(), c.close(), observer.close()]);
    }
    expect((await stored(provisioningId))?.status).toBe("deleted");
    // The erasure deletes the account of Auth after marking the row (hard delete). Nothing lives afterwards, and nothing is born again.
    await readRows("delete from auth.users where id = $1", [id]);
    expect(await accounts(id)).toBe(0);
    const again = await readRows(BORN, [id, canonicalEmail(id)]).then(() => null, pgCode);
    expect(again).toBe("P0004");
    expect(await accounts(id)).toBe(0);
  });

  it("an account that vanished from Auth without an erasure can be created again with the same id: the row is not deleted", async () => {
    const { provisioningId, id } = await rememberedStudent();
    await readRows(BORN, [id, canonicalEmail(id)]);
    await readRows("delete from auth.users where id = $1", [id]);
    expect(await accounts(id)).toBe(0);
    expect(await readRows(BORN, [id, canonicalEmail(id)]).then(() => null, pgCode)).toBeNull();
    expect(await accounts(id)).toBe(1);
    expect((await stored(provisioningId))?.id).toBe(id);
  });
});
