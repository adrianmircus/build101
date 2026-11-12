import { readRows } from "../support/db";
import type { Step } from "../support/race";
import { teacherOf } from "../support/world";
import { at } from "./version-ops-support";
import { exerciseOf, mustWork, saveStep, startStep, startedWithDraft, submitStep, published, type Published, type Student } from "./attempts-support";

// Shared by grading.test.ts and grading-locks.test.ts (races of T1.5c). A version published to students with an account, built only
// through the RPCs and committed; the attempts are submitted by the students and graded by the teacher of the group. Placeholder text only.

export type Grading = { feedback: string; score?: number | null; revision?: number | null; status?: "correct" | "partial" | "wrong" | "blank" };

/** The results of the one exercise of the publication, as the RPC takes them. */
export function resultsOf(p: Published, status: NonNullable<Grading["status"]>): string {
  return JSON.stringify({ [exerciseOf(p)]: { status, errors: [] } });
}

/** The teacher of the group grades the attempt of the student. */
export function gradeStep(p: Published, s: Student, g: Grading): Step {
  return {
    actor: teacherOf(p.r.o.world),
    rpc: "grade_attempt",
    args: {
      p_attempt_id: s.attemptId,
      p_feedback: g.feedback,
      p_exercise_results: resultsOf(p, g.status ?? "correct"),
      p_score: g.score === undefined ? 7 : g.score,
      p_revision: g.revision ?? null,
    },
  };
}

/** The teacher reads the attempt for grading (audited). */
export function readStep(p: Published, s: Student): Step {
  return { actor: teacherOf(p.r.o.world), rpc: "get_attempt_for_grading", args: { p_attempt_id: s.attemptId } };
}

/** The teacher lists the state of the assessment. */
export function listStep(p: Published): Step {
  return { actor: teacherOf(p.r.o.world), rpc: "list_assessment_attempts", args: { p_assessment_id: p.r.o.assessmentId } };
}

/** The student started, saved one answer (the draft is at revision 2) and submitted it. */
export async function submitted(p: Published, s: Student): Promise<void> {
  await startedWithDraft(p, s);
  await mustWork(submitStep(s, 2));
}

/** A version published to `count` students, every one of them with a submitted attempt and no grade. */
export async function submittedFor(count: number): Promise<Published> {
  const p = await published(count);
  for (const s of p.students) await submitted(p, s);
  return p;
}

/** A student that started and saved a draft, not submitted. */
export async function drafting(p: Published, s: Student): Promise<void> {
  await mustWork(startStep(s));
  await mustWork(saveStep(p, s, { revision: 1, text: "borrador" }));
}

export type GradeState = { rows: number; score: number | null; feedback: string | null; revision: number | null; assignment_status: string; assignment_revision: number };

/** What the attempt left: its grade (if any) and the state of its assignment. */
export async function gradeOf(s: Student): Promise<GradeState> {
  const rows = await readRows<GradeState>(
    `select (select count(*)::int from app.grades g where g.attempt_id = $1) as rows,
            g.score, g.feedback, g.revision, a.status as assignment_status, a.revision as assignment_revision
       from app.assignment_attempts t
       join app.assignments a on a.id = t.assignment_id
       left join app.grades g on g.attempt_id = t.id
      where t.id = $1`,
    [s.attemptId],
  );
  return at(rows, 0);
}
