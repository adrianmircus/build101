import "server-only";
import type { z } from "zod";
import type { Answers, AttemptStatus, Choices } from "@/lib/domain/delivery/entities";
import { callRpc, type RpcDb } from "./rpc";

// The attempt of a student (T1.5b), always through the student's own session: the database checks
// that the assignment is theirs. A stale draft revision is CONFLICT.

export type OpenedAttempt = { attemptId: string; status: AttemptStatus };

export async function openAttempt(db: RpcDb, assignmentId: string): Promise<OpenedAttempt> {
  return callRpc(db, "student_open_attempt", { p_assignment_id: assignmentId });
}

export type StartedAttempt = OpenedAttempt & { draftRevision: number };

export async function startAttempt(db: RpcDb, attemptId: string): Promise<StartedAttempt> {
  return callRpc(db, "student_start_attempt", { p_attempt_id: attemptId });
}

/** `revision` is the draft revision the student last read. */
export type DraftChanges = { revision: number; answers: z.infer<typeof Answers>; choices: z.infer<typeof Choices> };

export async function saveDraft(db: RpcDb, attemptId: string, changes: DraftChanges): Promise<{ revision: number }> {
  return callRpc(db, "student_save_draft", {
    p_attempt_id: attemptId,
    p_revision: changes.revision,
    p_answers: changes.answers,
    p_choices: changes.choices,
  });
}

export type Submitted = { submittedAt: string; late: boolean; alreadySubmitted: boolean };

export async function submitAttempt(db: RpcDb, attemptId: string, revision: number): Promise<Submitted> {
  return callRpc(db, "student_submit_attempt", { p_attempt_id: attemptId, p_revision: revision });
}
