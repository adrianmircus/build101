import { describe, expect, it } from "vitest";
import { countRows, readRows } from "../support/db";
import { heldRace, stampede } from "../support/race";
import { describeOutcome } from "../support/session";
import { publishStep, publishedIds } from "./publish-support";
import { at } from "./version-ops-support";
import { mustWork, published, startedWithDraft, submitStep } from "./attempts-support";
import { gradeOf, gradeStep, submitted, submittedFor } from "./grading-support";

// The grade of an attempt under concurrent writers (T1.5c). Each test keeps the first transaction open, starts the second on another
// connection, waits to see it blocked and only then lets the first commit, so the second runs strictly after the first one's commit
// as if it had arrived in the middle. Without the lock on the assignment the second one does not wait: it does not see the first
// one's grade (or its submission) and decides on a stale read, and the assertions fail (two first grades collide on the unique
// index as a raw 23505). Placeholder text only. The ORDER of the locks is in grading-locks.test.ts.

describe("race: two grades at once", () => {
  it("two first grades with different content: the second waits and is revision_mismatch, so the first one's grade is not overwritten", async () => {
    const p = await submittedFor(1);
    const s = at(p.students, 0);
    const held = await heldRace(gradeStep(p, s, { feedback: "de la pestaña A", score: 6 }), gradeStep(p, s, { feedback: "de la pestaña B", score: 9 }));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect(await gradeOf(s)).toMatchObject({ rows: 1, score: 6, feedback: "de la pestaña A", revision: 1, assignment_status: "graded" });
  });

  it("two edits from the same revision: one wins, the other is revision_mismatch and the revision goes up once", async () => {
    const p = await submittedFor(1);
    const s = at(p.students, 0);
    await mustWork(gradeStep(p, s, { feedback: "primera" }));
    const held = await heldRace(gradeStep(p, s, { feedback: "de A", score: 5, revision: 1 }), gradeStep(p, s, { feedback: "de B", score: 8, revision: 1 }));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect(await gradeOf(s)).toMatchObject({ rows: 1, score: 5, feedback: "de A", revision: 2 });
  });

  it("the same first grade twice (a double click): the second waits and answers the same grade, and there is one row", async () => {
    const p = await submittedFor(1);
    const s = at(p.students, 0);
    const held = await heldRace(gradeStep(p, s, { feedback: "Bien", score: 8 }), gradeStep(p, s, { feedback: "Bien", score: 8 }));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(held.second.ok && held.second.value).toEqual(held.first.ok && held.first.value);
    expect(await gradeOf(s)).toMatchObject({ rows: 1, revision: 1, assignment_revision: 4 });
  });

  it("many identical first grades at once: all answer ok with the same revision, and exactly one row is written", async () => {
    const p = await submittedFor(1);
    const s = at(p.students, 0);
    const outcomes = await stampede(Array.from({ length: 6 }, () => gradeStep(p, s, { feedback: "Bien", score: 8 })));
    expect(outcomes.map(describeOutcome)).toEqual(Array.from({ length: 6 }, () => "ok"));
    expect(new Set(outcomes.map((outcome) => outcome.ok && outcome.value.revision))).toEqual(new Set([1]));
    expect(await gradeOf(s)).toMatchObject({ rows: 1, revision: 1, assignment_status: "graded", assignment_revision: 4 });
  });

  it("many different first grades at once: exactly one is written, the rest are revision_mismatch, and none is a raw 23505", async () => {
    const p = await submittedFor(1);
    const s = at(p.students, 0);
    const outcomes = await stampede(Array.from({ length: 6 }, (_, index) => gradeStep(p, s, { feedback: `de la pestaña ${index}`, score: index + 1 })));
    const described = outcomes.map(describeOutcome);
    expect(described.filter((text) => text === "ok")).toHaveLength(1);
    expect(described.filter((text) => text === "P0001 CONFLICT revision_mismatch")).toHaveLength(5);
    expect(await countRows("select count(*) as n from app.grades where attempt_id = $1", [s.attemptId])).toBe(1);
  });
});

describe("race: a grade and a submission that arrives late", () => {
  it("a submission that commits first: the grade waits for the assignment, finds it submitted and grades it", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    await startedWithDraft(p, s);
    await readRows("update app.assessments set due_at = now() - interval '1 hour' where id = $1", [p.r.o.assessmentId]);
    const held = await heldRace(submitStep(s, 2), gradeStep(p, s, { feedback: "Entrega tardía", score: 4 }));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(held.first.ok && held.first.value.late).toBe(true);
    expect(await gradeOf(s)).toMatchObject({ rows: 1, score: 4, revision: 1, assignment_status: "graded" });
  });

  it("a grade that commits first and then the submission of the same attempt: the second click finds it submitted and the grade stays", async () => {
    const p = await submittedFor(1);
    const s = at(p.students, 0);
    const held = await heldRace(gradeStep(p, s, { feedback: "Bien" }), submitStep(s, 2));
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(held.second.ok && held.second.value.alreadySubmitted).toBe(true);
    expect(await gradeOf(s)).toMatchObject({ rows: 1, revision: 1, assignment_status: "graded" });
  });
});

describe("race: a grade and a new publication of the same version", () => {
  it("a publication that commits first: the grade waits for the assignment and grades the attempt, which kept its own publication", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    await submitted(p, s);
    const held = await heldRace(await publishStep(p.r), gradeStep(p, s, { feedback: "Bien", score: 9 }));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(held.first.ok && held.first.value.attempts).toBe(0);
    expect(await gradeOf(s)).toMatchObject({ rows: 1, score: 9, assignment_status: "graded" });
    const publication = await readRows<{ publication_id: string }>("select publication_id::text from app.assignment_attempts where id = $1", [s.attemptId]);
    expect(at(publication, 0).publication_id).toBe(p.publication);
  });

  it("a grade that commits first: the publication waits for the assignment, does not move the attempt and finds the grade intact", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    await submitted(p, s);
    const held = await heldRace(gradeStep(p, s, { feedback: "Bien", score: 9 }), await publishStep(p.r));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(held.second.ok && held.second.value.attempts).toBe(0);
    expect(await gradeOf(s)).toMatchObject({ rows: 1, score: 9, revision: 1, assignment_status: "graded" });
  });

  it("at the same time, again and again: no deadlock, every grade is written and every publication is made", async () => {
    const rounds = 6;
    const p = await submittedFor(rounds);
    for (const s of p.students) {
      const outcomes = await stampede([gradeStep(p, s, { feedback: "Bien" }), await publishStep(p.r)]);
      // 40P01 would be a deadlock: both take the assignment before anything of the attempt.
      expect(outcomes.map(describeOutcome)).toEqual(["ok", "ok"]);
      expect(await gradeOf(s)).toMatchObject({ rows: 1, revision: 1, assignment_status: "graded" });
    }
    expect(await publishedIds(p.r.version)).toHaveLength(rounds + 1);
  });
});
