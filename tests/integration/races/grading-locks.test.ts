import { describe, expect, it } from "vitest";
import { mustWork, type Published, type Student } from "./attempts-support";
import { gradeStep, listStep, readStep, submittedFor } from "./grading-support";
import { ASSIGNMENT_ROW, ATTEMPT_ROW, DRAFT_ROW, GRADE_ROW, holdAssignment, holdAttempt, holdDraft, holdGrade, nowait, whileWaiting } from "./grading-probes";

// The lock order of grade_attempt (T1.5c): app.lock_attempt_tree takes the assignment, then the attempt, then the draft, and the
// grade row comes after all of them: the last level of the order of docs/contratos/fase-1.md. publish_version takes an assignment
// before its attempts, and the student's RPCs follow the same order, so none of them can cross. Each probe is deterministic and does
// not depend on which row two calls fight for (see grading-probes.ts). waitedOn is not enough on its own: it would also accept a
// wait further down. Placeholder text only.

async function submittedOne(): Promise<{ p: Published; s: Student }> {
  const p = await submittedFor(1);
  const s = p.students[0];
  if (!s) throw new Error("Falta el estudiante.");
  return { p, s };
}

// The grade that exists already is edited with its revision; the first one has no row to compare with.
const FIRST = { name: "the first grade", graded: false };
const EDIT = { name: "an edit of the grade", graded: true };

describe.each([FIRST, EDIT])("race: $name takes the assignment, then the attempt, then the draft, then the grade", ({ graded }) => {
  async function prepare(): Promise<{ p: Published; s: Student; grade: () => ReturnType<typeof gradeStep> }> {
    const { p, s } = await submittedOne();
    if (graded) await mustWork(gradeStep(p, s, { feedback: "primera" }));
    return { p, s, grade: () => gradeStep(p, s, { feedback: "segunda", score: 9, revision: graded ? 1 : null }) };
  }

  it("waits on the assignment and has taken neither the attempt, the draft nor the grade", async () => {
    const { s, grade } = await prepare();
    const held = await whileWaiting(grade(), holdAssignment(s), async (prober) => ({
      attempt: await nowait(prober, ATTEMPT_ROW, s.attemptId),
      draft: await nowait(prober, DRAFT_ROW, s.attemptId),
      grade: await nowait(prober, GRADE_ROW, s.attemptId),
    }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    expect(held.states).toEqual({ attempt: "free", draft: "free", grade: "free" });
  });

  it("waits on the attempt already holding the assignment, and has taken neither the draft nor the grade", async () => {
    const { s, grade } = await prepare();
    const held = await whileWaiting(grade(), holdAttempt(s), async (prober) => ({
      assignment: await nowait(prober, ASSIGNMENT_ROW, s.assignmentId),
      draft: await nowait(prober, DRAFT_ROW, s.attemptId),
      grade: await nowait(prober, GRADE_ROW, s.attemptId),
    }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    expect(held.states).toEqual({ assignment: "55P03", draft: "free", grade: "free" });
  });

  it("waits on the draft already holding the assignment and the attempt, and has not taken the grade", async () => {
    const { s, grade } = await prepare();
    const held = await whileWaiting(grade(), holdDraft(s), async (prober) => ({
      assignment: await nowait(prober, ASSIGNMENT_ROW, s.assignmentId),
      attempt: await nowait(prober, ATTEMPT_ROW, s.attemptId),
      grade: await nowait(prober, GRADE_ROW, s.attemptId),
    }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    expect(held.states).toEqual({ assignment: "55P03", attempt: "55P03", grade: "free" });
  });

  it.runIf(graded)("waits on the grade last, already holding the assignment, the attempt and the draft", async () => {
    const { s, grade } = await prepare();
    const held = await whileWaiting(grade(), holdGrade(s), async (prober) => ({
      assignment: await nowait(prober, ASSIGNMENT_ROW, s.assignmentId),
      attempt: await nowait(prober, ATTEMPT_ROW, s.attemptId),
      draft: await nowait(prober, DRAFT_ROW, s.attemptId),
    }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.result).toBe("ok");
    expect(held.states).toEqual({ assignment: "55P03", attempt: "55P03", draft: "55P03" });
  });
});

describe("race: the two reads take no lock", () => {
  it.each([
    { name: "get_attempt_for_grading", step: (p: Published, s: Student) => readStep(p, s) },
    { name: "list_assessment_attempts", step: (p: Published) => listStep(p) },
  ])("$name does not wait for the assignment, the attempt, the draft or the grade held by a writer, and answers", async ({ step }) => {
    const { p, s } = await submittedOne();
    await mustWork(gradeStep(p, s, { feedback: "primera" }));
    for (const hold of [holdAssignment(s), holdAttempt(s), holdDraft(s), holdGrade(s)]) {
      const held = await whileWaiting(step(p, s), hold, async () => ({}));
      expect(held.waitedOn).toBeNull();
      expect(held.result).toBe("ok");
    }
  });
});
