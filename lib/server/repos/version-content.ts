import "server-only";
import type { QuestionKey, VersionQuestion } from "@/lib/domain/assessments/versions";
import { callRpc, type RpcDb } from "./rpc";

// Content of a version and its approval (T1.4c). Every edit of the content moves the revision of
// the version and drops its approval; the database decides, a repo only translates names and types.
// Each write takes an opId: one per attempt, kept on a retry, so the same id never applies twice.

/** What an edit of an exercise or a question gives back: its own revision and the version's. */
export type ContentWritten = { id: string; revision: number; versionRevision: number };

export type InstructionsChanges = {
  /** The version's `instructionsRevision` the caller read: a stale one is CONFLICT. */
  revision: number;
  generalInstructions: string;
  opId: string;
};

export async function updateVersionInstructions(
  db: RpcDb,
  versionId: string,
  changes: InstructionsChanges,
): Promise<{ id: string; instructionsRevision: number; versionRevision: number }> {
  return callRpc(db, "update_version_instructions", {
    p_version_id: versionId,
    p_revision: changes.revision,
    p_general_instructions: changes.generalInstructions,
    p_op_id: changes.opId,
  });
}

/** `revision` is the adapted exercise's own. An empty body puts it back to pending. */
export type ExerciseBodyChanges = { revision: number; body: string; opId: string };

export async function updateVersionExercise(
  db: RpcDb,
  versionExerciseId: string,
  changes: ExerciseBodyChanges,
): Promise<ContentWritten> {
  return callRpc(db, "update_version_exercise", {
    p_version_exercise_id: versionExerciseId,
    p_revision: changes.revision,
    p_body: changes.body,
    p_op_id: changes.opId,
  });
}

/** `revision` is the question's own. Taking out the correct option is INVALID. */
export type QuestionChanges = {
  revision: number;
  stem: VersionQuestion["stem"];
  options: VersionQuestion["options"];
  opId: string;
};

export async function updateVersionQuestion(
  db: RpcDb,
  questionId: string,
  changes: QuestionChanges,
): Promise<ContentWritten> {
  return callRpc(db, "update_version_question", {
    p_question_id: questionId,
    p_revision: changes.revision,
    p_stem: changes.stem,
    p_options: changes.options,
    p_op_id: changes.opId,
  });
}

/** `revision` comes from `keys` of getVersion; leave it out only for the first key of the question. */
export type QuestionKeyChange = { correctOptionId: QuestionKey["correctOptionId"]; revision?: number };

export async function setQuestionKey(
  db: RpcDb,
  questionId: string,
  change: QuestionKeyChange,
): Promise<{ questionId: string; revision: number }> {
  return callRpc(db, "set_question_key", {
    p_question_id: questionId,
    p_correct_option_id: change.correctOptionId,
    p_revision: change.revision,
  });
}

export type VersionDecision = { revision: number; opId: string };

/** Fails with CONFLICT while the content is incomplete or `revision` is stale. */
export async function approveVersion(
  db: RpcDb,
  versionId: string,
  decision: VersionDecision,
): Promise<{ id: string; approvedRevision: number }> {
  return callRpc(db, "approve_version", {
    p_version_id: versionId,
    p_revision: decision.revision,
    p_op_id: decision.opId,
  });
}

export type VersionRejection = VersionDecision & {
  /** Ids of the rejection catalogue: a closed list, never free text. */
  reasons: string[];
};

export async function rejectVersion(
  db: RpcDb,
  versionId: string,
  rejection: VersionRejection,
): Promise<{ eventId: string }> {
  return callRpc(db, "reject_version", {
    p_version_id: versionId,
    p_revision: rejection.revision,
    p_reasons: rejection.reasons,
    p_op_id: rejection.opId,
  });
}
