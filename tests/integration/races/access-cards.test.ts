import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { activeStudent, cardOf, cardState, issueArgs, issueAsTeacher } from "../support/accounts";
import { countRows, openSession, readRows, runRpc } from "../support/db";
import { heldRace, pgCode, stampede, waitUntilBlocked } from "../support/race";
import { describeOutcome } from "../support/session";
import { createWorld, SERVICE, teacherOf } from "../support/world";

// T2.5a, «Emitir tarjetas» (F2C-4, F2C-30, F2C-50, F2C-51, F2C-75): issue_access_cards is one transaction that locks the students in
// id order. Two issues at once for the same student wait for each other and leave one active card, the credential of the last one to
// commit and the sessions closed; the same op_key twice is serialized by its own lock; a bind of a session and an issue cannot leave a
// session alive in either order.

const teacher = (world: Awaited<ReturnType<typeof createWorld>>) => teacherOf(world);

async function sessionOf(authUserId: string): Promise<string> {
  const rows = await readRows<{ id: string }>("insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), $1, now(), now()) returning id", [authUserId]);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("Falta la sesión de prueba.");
  return id;
}

const sessionsLeft = (authUserId: string) => countRows("select count(*) as n from auth.sessions where user_id = $1", [authUserId]);
const registered = (studentId: string) => countRows("select count(*) as n from app.student_sessions where student_id = $1", [studentId]);

describe("race: two issues of cards for the same student", () => {
  it("held: the second waits for the first, and what is left is the card, the credential and the version of the last one", async () => {
    const world = await createWorld();
    const student = await activeStudent(world);
    const a = cardOf(student.studentId, "a");
    const b = cardOf(student.studentId, "b");
    const held = await heldRace(
      { actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [a]) },
      { actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [b]) },
    );
    // Without the lock on the students the second one does not wait: it revokes nothing it can see and the unique index of active cards answers 23505.
    expect(held.waitedOn, "the second issue waits for the lock of the student").not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(await cardState(student.studentId)).toEqual({ active: 1, revoked: 1, activeToken: b.tokenHash, version: 2, passwordHash: b.passwordHash });
  });

  it("a burst of four: one active card, and it is the one whose password is the credential", async () => {
    for (let round = 0; round < 3; round += 1) {
      const world = await createWorld();
      const student = await activeStudent(world);
      const cards = ["a", "b", "c", "d"].map((seed) => cardOf(student.studentId, `${round}${seed}`));
      const outcomes = await stampede(cards.map((card) => ({ actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [card]) })));
      expect(outcomes.map(describeOutcome)).toEqual(["ok", "ok", "ok", "ok"]);
      const state = await cardState(student.studentId);
      expect(state).toMatchObject({ active: 1, revoked: 3, version: 4 });
      const winner = cards.find((card) => card.tokenHash === state.activeToken);
      expect(winner, "the active card is one of the requests").toBeDefined();
      // The pair of the winner: the token that works and the password that works come from the same request.
      expect(state.passwordHash).toBe(winner?.passwordHash);
    }
  });

  it("the same op_key and the same set, held: the second waits on the advisory lock and answers card_issue_done", async () => {
    const world = await createWorld();
    const student = await activeStudent(world);
    const key = randomUUID();
    const held = await heldRace(
      { actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [cardOf(student.studentId, "a")], key) },
      { actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [cardOf(student.studentId, "b")], key) },
    );
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT card_issue_done");
    expect(await cardState(student.studentId)).toMatchObject({ active: 1, revoked: 0, version: 1 });
  });

  it("the same op_key with another set, held: op_key_reused", async () => {
    const world = await createWorld();
    const [one, two] = [await activeStudent(world), await activeStudent(world)];
    const key = randomUUID();
    const held = await heldRace(
      { actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [cardOf(one.studentId, "a")], key) },
      { actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [cardOf(one.studentId, "b"), cardOf(two.studentId, "c")], key) },
    );
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect((await cardState(two.studentId)).active).toBe(0);
  });

  it("overlapping sets asked in opposite orders never deadlock: the students are locked in id order", async () => {
    for (let round = 0; round < 5; round += 1) {
      const world = await createWorld();
      const [one, two] = [await activeStudent(world), await activeStudent(world)];
      const outcomes = await stampede([
        { actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [cardOf(one.studentId, `${round}a`), cardOf(two.studentId, `${round}b`)]) },
        { actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [cardOf(two.studentId, `${round}c`), cardOf(one.studentId, `${round}d`)]) },
      ]);
      expect(outcomes.map(describeOutcome)).toEqual(["ok", "ok"]);
      for (const student of [one, two]) expect(await cardState(student.studentId)).toMatchObject({ active: 1, revoked: 1, version: 2 });
    }
  });

  it("order of the locks: while a student is held, the issue waits for him before it touches his cards or his credential", async () => {
    const world = await createWorld();
    const student = await activeStudent(world);
    expect(describeOutcome(await issueAsTeacher(world, [cardOf(student.studentId, "seed")]))).toBe("ok");
    const [holder, issuing, observer, probe] = await Promise.all([openSession(), openSession(), openSession(), openSession()]);
    try {
      await holder.beginAsOwner();
      await holder.rows("select id from app.students where id = $1 for update", [student.studentId]);
      await issuing.begin(teacher(world));
      let done = false;
      const pending = issuing.call("issue_access_cards", issueArgs(world.groupId, [cardOf(student.studentId, "next")])).finally(() => {
        done = true;
      });
      expect(await waitUntilBlocked(issuing, observer, () => done), "the issue waits for the row of the student").not.toBeNull();
      // A third connection takes the children with NOWAIT: if the issue had them already, this fails with 55P03.
      await probe.beginAsOwner();
      await probe.rows("select 1 from app.student_credentials where student_id = $1 for update nowait", [student.studentId]);
      await probe.rows("select 1 from app.access_cards where student_id = $1 for update nowait", [student.studentId]);
      await probe.rollback();
      await holder.commit();
      const outcome = await pending;
      expect(describeOutcome(outcome)).toBe("ok");
      await issuing.commit();
    } finally {
      await Promise.all([holder.close(), issuing.close(), observer.close(), probe.close()]);
    }
    expect(await cardState(student.studentId)).toMatchObject({ active: 1, revoked: 1, version: 2 });
  });
});

describe("race: the bind of a session and a new card", () => {
  async function loggedIn() {
    const world = await createWorld();
    const student = await activeStudent(world);
    expect(describeOutcome(await issueAsTeacher(world, [cardOf(student.studentId, "first")]))).toBe("ok");
    return { world, student, sessionId: await sessionOf(student.authUserId) };
  }

  const bind = (userId: string, sessionId: string, version: number) => ({
    actor: SERVICE,
    rpc: "internal_bind_student_session",
    args: { p_auth_user_id: userId, p_session_id: sessionId, p_version: version },
  });

  it("the card is issued between the check of the password and the bind: the bind waits, sees another version, and deletes the session", async () => {
    const { world, student, sessionId } = await loggedIn();
    const held = await heldRace(
      { actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [cardOf(student.studentId, "second")]) },
      bind(student.authUserId, sessionId, 1),
    );
    expect(held.waitedOn, "the bind takes the same lock of the student").not.toBeNull();
    expect(held.second).toEqual({ ok: true, value: { ok: false } });
    expect(await sessionsLeft(student.authUserId)).toBe(0);
    expect(await registered(student.studentId)).toBe(0);
  });

  it("the card is issued after the bind: the issue waits for it, and closes the session and its registry row", async () => {
    const { world, student, sessionId } = await loggedIn();
    const held = await heldRace(
      bind(student.authUserId, sessionId, 1),
      { actor: teacher(world), rpc: "issue_access_cards", args: issueArgs(world.groupId, [cardOf(student.studentId, "second")]) },
    );
    expect(held.waitedOn, "the issue waits for the bind").not.toBeNull();
    expect(held.first).toEqual({ ok: true, value: { ok: true } });
    expect(describeOutcome(held.second)).toBe("ok");
    expect(await sessionsLeft(student.authUserId)).toBe(0);
    expect(await registered(student.studentId)).toBe(0);
  });

  it("the bind holds the lock of the student, the one issue_access_cards takes (the foreign keys alone would only share it)", async () => {
    const { student, sessionId } = await loggedIn();
    const [binding, probe] = await Promise.all([openSession(), openSession()]);
    try {
      await binding.begin(SERVICE);
      const bound = await binding.call("internal_bind_student_session", { p_auth_user_id: student.authUserId, p_session_id: sessionId, p_version: 1 });
      expect(describeOutcome(bound)).toBe("ok");
      await probe.beginAsOwner();
      // FOR NO KEY UPDATE conflicts with the FOR UPDATE of the bind but not with the KEY SHARE that a foreign key takes.
      const refused = await probe.rows("select 1 from app.students where id = $1 for no key update nowait", [student.studentId]).then(() => null, pgCode);
      expect(refused).toBe("55P03");
      await probe.rollback();
      await binding.commit();
    } finally {
      await Promise.all([binding.close(), probe.close()]);
    }
  });

  it("a bind that arrives alone with the current version registers the session; two binds of the same session answer the same", async () => {
    const { student, sessionId } = await loggedIn();
    const first = await runRpc(SERVICE, "internal_bind_student_session", { p_auth_user_id: student.authUserId, p_session_id: sessionId, p_version: 1 });
    const second = await runRpc(SERVICE, "internal_bind_student_session", { p_auth_user_id: student.authUserId, p_session_id: sessionId, p_version: 1 });
    expect([first, second]).toEqual([{ ok: true, value: { ok: true } }, { ok: true, value: { ok: true } }]);
    expect(await registered(student.studentId)).toBe(1);
  });

  it("a student of another group is refused as not_enrolled and nothing changes", async () => {
    const world = await createWorld();
    const outsider = await activeStudent(await createWorld());
    const outcome = await issueAsTeacher(world, [cardOf(outsider.studentId, "x")]);
    expect(describeOutcome(outcome)).toBe("P0001 INVALID not_enrolled");
    expect(await cardState(outsider.studentId)).toMatchObject({ active: 0, version: null });
  });
});
