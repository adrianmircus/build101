import { describe, expect, it } from "vitest";
import { heldRace, stampede } from "../support/race";
import { describeOutcome } from "../support/session";
import { countRows } from "../support/db";
import { publishStep, publishedIds } from "./publish-support";
import { at } from "./version-ops-support";
import { published, saveStep, startStep, startedWithDraft, stateOf, submitStep } from "./attempts-support";

// The attempt of a student under concurrent writers (T1.5b). Each test keeps the first transaction open, starts the second on
// another connection, waits to see it blocked and only then lets the first commit, so the second runs strictly after the
// first one's commit as if it had arrived in the middle. Without the lock the second one does not wait for the first: it
// reads the attempt as it was before and the assertions on the outcomes fail (the ones that would still run decide on a
// stale read). Placeholder text only. The ORDER of the locks is in attempts-locks.test.ts.

describe("race: submitting", () => {
  it("two submissions at once: the second waits, finds it submitted and answers the first one's work, changing nothing", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    await startedWithDraft(p, s);
    const held = await heldRace(submitStep(s, 2), submitStep(s, 2));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(held.first.ok && held.first.value.alreadySubmitted).toBe(false);
    expect(held.second.ok && held.second.value.alreadySubmitted).toBe(true);
    expect(held.second.ok && held.second.value.submittedAt).toEqual(held.first.ok && held.first.value.submittedAt);
    const state = await stateOf(s);
    // Submitted once: the attempt and the assignment each went up by one revision after the start.
    expect(state).toMatchObject({ status: "submitted", revision: 3, assignment_status: "submitted", assignment_revision: 3, draft: 2 });
  });

  it("many submissions at once: exactly one of them submits", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    await startedWithDraft(p, s);
    const outcomes = await stampede(Array.from({ length: 6 }, () => submitStep(s, 2)));
    expect(outcomes.map(describeOutcome)).toEqual(Array.from({ length: 6 }, () => "ok"));
    expect(outcomes.filter((outcome) => outcome.ok && outcome.value.alreadySubmitted === false)).toHaveLength(1);
    expect(new Set(outcomes.map((outcome) => outcome.ok && outcome.value.submittedAt)).size).toBe(1);
    expect(await stateOf(s)).toMatchObject({ status: "submitted", revision: 3 });
  });

  it("a draft saved from another tab before the submission commits: the submission with the older revision is draft_outdated and submits nothing", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    await startedWithDraft(p, s);
    const held = await heldRace(saveStep(p, s, { revision: 2, text: "otra pestaña" }), submitStep(s, 2));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT draft_outdated");
    const state = await stateOf(s);
    expect(state).toMatchObject({ status: "started", draft: 3, assignment_status: "in_progress" });
    expect(state.submitted_at).toBeNull();
    expect(state.answers).toEqual({ [at(p.r.adapted, 0)]: { text: "otra pestaña", mode: "typed" } });
    // With the revision the other tab left, the student does submit what they see.
    const second = await heldRace(submitStep(s, 3), submitStep(s, 3));
    expect(describeOutcome(second.first)).toBe("ok");
    expect((await stateOf(s)).status).toBe("submitted");
  });

  it("a submission that commits first: the save of another tab waits and is CONFLICT already_submitted; the draft stays frozen", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    await startedWithDraft(p, s);
    const held = await heldRace(submitStep(s, 2), saveStep(p, s, { revision: 2, text: "tarde" }));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT already_submitted");
    const state = await stateOf(s);
    expect(state).toMatchObject({ status: "submitted", draft: 2 });
    expect(state.answers).toEqual({ [at(p.r.adapted, 0)]: { text: "primera", mode: "typed" } });
  });
});

describe("race: saving", () => {
  it("two saves with the same revision at once: the second waits and is revision_mismatch, so the first one's draft is not overwritten", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    await startedWithDraft(p, s);
    const held = await heldRace(saveStep(p, s, { revision: 2, text: "de la pestaña A" }), saveStep(p, s, { revision: 2, text: "de la pestaña B" }));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    const state = await stateOf(s);
    expect(state.draft).toBe(3);
    expect(state.answers).toEqual({ [at(p.r.adapted, 0)]: { text: "de la pestaña A", mode: "typed" } });
  });

  it("two starts at once: the second waits, answers the same and there is a single draft", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    const held = await heldRace(startStep(s), startStep(s));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(held.second.ok && held.second.value).toEqual(held.first.ok && held.first.value);
    expect(await countRows("select count(*) as n from app.submissions where attempt_id = $1", [s.attemptId])).toBe(1);
    expect(await stateOf(s)).toMatchObject({ status: "started", revision: 2, assignment_status: "in_progress", assignment_revision: 2 });
  });
});

describe("race: a submission and a new publication of the same version", () => {
  it("a publication that commits first: the submission waits for the assignment and ends with the attempt submitted and on its own publication", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    await startedWithDraft(p, s);
    const held = await heldRace(await publishStep(p.r), submitStep(s, 2));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    // The attempt had started: the publication does not move it.
    expect(held.first.ok && held.first.value.attempts).toBe(0);
    const state = await stateOf(s);
    expect(state).toMatchObject({ status: "submitted", publication: p.publication, draft: 2 });
    expect(state.answers).toEqual({ [at(p.r.adapted, 0)]: { text: "primera", mode: "typed" } });
    expect(await publishedIds(p.r.version)).toHaveLength(2);
  });

  it("a submission that commits first: the publication waits for the assignment, does not move it and finds it intact", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    await startedWithDraft(p, s);
    const held = await heldRace(submitStep(s, 2), await publishStep(p.r));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(held.second.ok && held.second.value.attempts).toBe(0);
    const state = await stateOf(s);
    expect(state).toMatchObject({ status: "submitted", publication: p.publication, revision: 3 });
    // The time of the submission is the one the student was told.
    const told = held.first.ok ? String(held.first.value.submittedAt) : "";
    expect(await countRows("select count(*) as n from app.assignment_attempts where id = $1 and submitted_at = $2::timestamptz", [s.attemptId, told])).toBe(1);
  });

  it("a start that commits first: the publication waits and does not move the attempt that just started", async () => {
    const p = await published(2);
    const [one, two] = p.students;
    if (!one || !two) throw new Error("Faltan estudiantes.");
    const held = await heldRace(startStep(one), await publishStep(p.r));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    // Only the attempt nobody started moved.
    expect(held.second.ok && held.second.value.attempts).toBe(1);
    expect((await stateOf(one)).publication).toBe(p.publication);
    expect((await stateOf(two)).publication).not.toBe(p.publication);
  });

  it("a publication that commits first: the start waits for the assignment and starts the attempt on the new publication", async () => {
    const p = await published(1);
    const s = at(p.students, 0);
    const held = await heldRace(await publishStep(p.r), startStep(s));
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.first)).toBe("ok");
    expect(describeOutcome(held.second)).toBe("ok");
    const state = await stateOf(s);
    expect(state.status).toBe("started");
    expect(state.publication).not.toBe(p.publication);
  });

  it("at the same time, again and again: no deadlock, every submission is submitted and none of the attempts is moved from its publication", async () => {
    const rounds = 8;
    const p = await published(rounds);
    for (const s of p.students) await startedWithDraft(p, s);
    for (const s of p.students) {
      const outcomes = await stampede([submitStep(s, 2), await publishStep(p.r)]);
      // 40P01 would be a deadlock: the order of the locks of the two is the same.
      expect(outcomes.map(describeOutcome)).toEqual(["ok", "ok"]);
      expect(await stateOf(s)).toMatchObject({ status: "submitted", publication: p.publication, draft: 2, revision: 3 });
    }
    expect(await publishedIds(p.r.version)).toHaveLength(rounds + 1);
  });
});
