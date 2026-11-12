import { readRows, runRpc } from "../support/db";
import type { Step } from "../support/race";
import { describeOutcome, type Actor } from "../support/session";
import { studentAccount } from "../support/accounts";
import { SERVICE } from "../support/world";
import { at } from "./version-ops-support";
import { attemptOf, attemptRows, publishNow, ready, type Ready } from "./publish-support";

// Shared by attempts.test.ts and attempts-locks.test.ts (races of T1.5b). A version published to students that have an
// account, built only through the RPCs and committed. Placeholder text only.

export type Student = { studentId: string; actor: Actor; assignmentId: string; attemptId: string };
export type Published = { r: Ready; students: Student[]; publication: string };

/** A typed version with one adapted exercise, published to `count` students with an account each: every attempt is opened. */
export async function published(count: number): Promise<Published> {
  const r = await ready(1, count);
  const accounts: string[] = [];
  for (const studentId of r.students) {
    const userId = await studentAccount(studentId);
    const linked = await runRpc(SERVICE, "internal_link_student_user", { p_student_id: studentId, p_user_id: userId });
    if (!linked.ok) throw new Error(`No se pudo vincular la cuenta del estudiante: ${describeOutcome(linked)}.`);
    accounts.push(userId);
  }
  const publication = await publishNow(r);
  const rows = await attemptRows(r.o.assessmentId);
  const students = r.students.map((studentId, index) => {
    const row = attemptOf(rows, studentId);
    return { studentId, actor: { role: "authenticated", userId: at(accounts, index) } satisfies Actor, assignmentId: row.assignment, attemptId: row.id };
  });
  return { r, students, publication };
}

export function exerciseOf(p: Published): string {
  return at(p.r.adapted, 0);
}

/** A draft with one typed answer to the exercise. */
export function draftOf(p: Published, text: string): string {
  return JSON.stringify({ [exerciseOf(p)]: { text, mode: "typed" } });
}

export function openStep(s: Student): Step {
  return { actor: s.actor, rpc: "student_open_attempt", args: { p_assignment_id: s.assignmentId } };
}

export function startStep(s: Student): Step {
  return { actor: s.actor, rpc: "student_start_attempt", args: { p_attempt_id: s.attemptId } };
}

export function saveStep(p: Published, s: Student, draft: { revision: number; text: string }): Step {
  return { actor: s.actor, rpc: "student_save_draft", args: { p_attempt_id: s.attemptId, p_revision: draft.revision, p_answers: draftOf(p, draft.text), p_choices: "{}" } };
}

export function submitStep(s: Student, revision: number): Step {
  return { actor: s.actor, rpc: "student_submit_attempt", args: { p_attempt_id: s.attemptId, p_revision: revision } };
}

/** Runs a step in its own transaction and demands that it worked. */
export async function mustWork(step: Step): Promise<Record<string, unknown>> {
  const outcome = await runRpc(step.actor, step.rpc, step.args);
  if (!outcome.ok) throw new Error(`${step.rpc} falló: ${describeOutcome(outcome)}.`);
  return outcome.value;
}

/** The student has started the attempt and saved one answer: the draft is at revision 2. */
export async function startedWithDraft(p: Published, s: Student): Promise<void> {
  await mustWork(startStep(s));
  await mustWork(saveStep(p, s, { revision: 1, text: "primera" }));
}

export type AttemptState = {
  status: string;
  revision: number;
  late: boolean;
  submitted_at: string | null;
  publication: string;
  draft: number | null;
  answers: Record<string, { text: string }> | null;
  assignment_status: string;
  assignment_revision: number;
};

export async function stateOf(s: Student): Promise<AttemptState> {
  const rows = await readRows<AttemptState>(
    `select t.status, t.revision, t.late, t.submitted_at::text as submitted_at, t.publication_id::text as publication,
            d.revision as draft, d.answers, a.status as assignment_status, a.revision as assignment_revision
       from app.assignment_attempts t
       join app.assignments a on a.id = t.assignment_id
       left join app.submissions d on d.attempt_id = t.id
      where t.id = $1`,
    [s.attemptId],
  );
  return at(rows, 0);
}

