import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSession, readRows } from "../support/db";
import { heldRace, waitUntilBlocked } from "../support/race";
import { describeOutcome, type Session } from "../support/session";
import { teacherOf } from "../support/world";
import { attemptOf, attemptRows, publishNow, publishStep, publishedIds, ready } from "./publish-support";
import { at } from "./version-ops-support";

// Publishing under concurrent writers (T1.5a). Each test keeps the first transaction open, starts the second on another
// connection, waits to see it blocked and only then lets the first commit, so the second runs strictly after the first
// one's commit as if it had arrived in the middle. Without the lock the second one does not wait and reads the world as
// it was before the first: the assertions on the outcomes fail. Placeholder text only. The ORDER of the locks (version,
// then assignments, then attempts) is in publish-locks.test.ts.

describe("race: publishing", () => {
  it("the same op_key twice at once: the second waits on the advisory lock and answers the first one's publication", async () => {
    const r = await ready(2, 2);
    const op = randomUUID();
    const held = await heldRace(await publishStep(r, { op }), await publishStep(r, { op }));
    expect(held.waitedOn).toBe("advisory");
    expect(held.first.ok && held.first.value.attempts).toBe(2);
    expect(held.second).toEqual(held.first);
    expect(await publishedIds(r.version)).toHaveLength(1);
    expect(await attemptRows(r.o.assessmentId)).toHaveLength(2);
  });

  it("two publications with different op_keys at once are serialized: both work and the attempts end on the second", async () => {
    const r = await ready(2, 2);
    const held = await heldRace(await publishStep(r), await publishStep(r));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    // The first one created the attempts and the second moved them: the same number for both.
    expect(held.first.ok && held.first.value.attempts).toBe(2);
    expect(held.second.ok && held.second.value.attempts).toBe(2);
    const publications = await publishedIds(r.version);
    expect(publications).toHaveLength(2);
    const attempts = await attemptRows(r.o.assessmentId);
    expect(attempts).toHaveLength(2);
    expect(attempts.every((row) => row.publication === publications[1] && row.number === 1)).toBe(true);
  });

  it("an edit of the version that commits first: the publication of the old revision is a CONFLICT and publishes nothing", async () => {
    const r = await ready(2, 1);
    const stale = await publishStep(r);
    const edit = {
      actor: teacherOf(r.o.world),
      rpc: "update_version_exercise",
      args: { p_version_exercise_id: at(r.adapted, 0), p_revision: 2, p_body: "Cambiado", p_op_id: randomUUID() },
    };
    const held = await heldRace(edit, stale);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect(await publishedIds(r.version)).toHaveLength(0);
    expect(await attemptRows(r.o.assessmentId)).toHaveLength(0);
  });

  it("a publication that commits first: the edit waits, works, and the copy keeps the old text", async () => {
    const r = await ready(2, 1);
    const edit = {
      actor: teacherOf(r.o.world),
      rpc: "update_version_exercise",
      args: { p_version_exercise_id: at(r.adapted, 0), p_revision: 2, p_body: "Cambiado", p_op_id: randomUUID() },
    };
    const held = await heldRace(await publishStep(r), edit);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    const [publication] = await publishedIds(r.version);
    const rows = await readRows<{ content: { exercises: { body: string }[] } }>("select content from app.publications where id = $1", [publication ?? ""]);
    expect(at(at(rows, 0).content.exercises, 0).body).toBe("Adaptado 1");
    const live = await readRows<{ body: string }>("select body from app.version_exercises where id = $1", [at(r.adapted, 0)]);
    expect(at(live, 0).body).toBe("Cambiado");
  });

  it("an unenrollment that commits first: the publication waits for the enrollment and is CONFLICT not_enrolled", async () => {
    const r = await ready(1, 1);
    const unenroll = {
      actor: teacherOf(r.o.world),
      rpc: "unenroll_student",
      args: { p_group_id: r.o.world.groupId, p_student_id: at(r.students, 0) },
    };
    const held = await heldRace(unenroll, await publishStep(r));
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT not_enrolled");
    expect(await publishedIds(r.version)).toHaveLength(0);
    expect(await attemptRows(r.o.assessmentId)).toHaveLength(0);
  });
});

// What student_start_attempt will do (T1.5b), written with SQL as the owner: assignment, then attempt, then the move to started.
async function startingAttempt(owner: Session, assignment: string, attempt: string): Promise<void> {
  await owner.beginAsOwner();
  await owner.rows("select id from app.assignments where id = $1 for update", [assignment]);
  await owner.rows("select id from app.assignment_attempts where id = $1 for update", [attempt]);
  await owner.rows("update app.assignment_attempts set status = 'started', started_at = now() where id = $1", [attempt]);
}

describe("race: publishing against an attempt that starts", () => {
  it("an attempt that starts first is not moved: the publication waits on its assignment and leaves it where it is", async () => {
    const r = await ready(1, 2);
    const firstPublication = await publishNow(r);
    const rows = await attemptRows(r.o.assessmentId);
    const mine = attemptOf(rows, at(r.students, 0));
    const [holder, caller, observer] = await Promise.all([openSession(), openSession(), openSession()]);
    try {
      await startingAttempt(holder, mine.assignment, mine.id);
      const step = await publishStep(r);
      await caller.begin(step.actor);
      let done = false;
      const pending = caller.call(step.rpc, step.args).finally(() => {
        done = true;
      });
      const waitedOn = await waitUntilBlocked(caller, observer, () => done);
      await holder.commit();
      const outcome = await pending;
      if (outcome.ok) await caller.commit();
      else await caller.rollback();
      expect(waitedOn).not.toBeNull();
      // Only the other student's attempt (nobody started it) moved.
      expect(outcome.ok && outcome.value.attempts).toBe(1);
      const after = await attemptRows(r.o.assessmentId);
      const publications = await publishedIds(r.version);
      expect(publications).toHaveLength(2);
      expect(attemptOf(after, at(r.students, 0))).toMatchObject({ status: "started", publication: firstPublication });
      expect(attemptOf(after, at(r.students, 1)).publication).toBe(publications[1]);
    } finally {
      await Promise.all([holder.close(), caller.close(), observer.close()]);
    }
  });

  it("a publication that commits first: the start waits on the assignment and finds the attempt on the new publication", async () => {
    const r = await ready(1, 1);
    await publishNow(r);
    const mine = attemptOf(await attemptRows(r.o.assessmentId), at(r.students, 0));
    const [publisher, starter, observer] = await Promise.all([openSession(), openSession(), openSession()]);
    try {
      const step = await publishStep(r);
      await publisher.begin(step.actor);
      const published = await publisher.call(step.rpc, step.args);
      expect(published.ok).toBe(true);
      await starter.beginAsOwner();
      let done = false;
      const pending = starter.rows("select id from app.assignments where id = $1 for update", [mine.assignment]).finally(() => {
        done = true;
      });
      const waitedOn = await waitUntilBlocked(starter, observer, () => done);
      await publisher.commit();
      await pending;
      const seen = await starter.rows<{ publication_id: string }>("select publication_id::text from app.assignment_attempts where id = $1", [mine.id]);
      await starter.commit();
      expect(waitedOn).not.toBeNull();
      const publications = await publishedIds(r.version);
      expect(at(seen, 0).publication_id).toBe(publications[1]);
    } finally {
      await Promise.all([publisher.close(), starter.close(), observer.close()]);
    }
  });
});
