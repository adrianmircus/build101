import "server-only";
import type { Written } from "@/lib/domain/common";
import type { Assessment, AssessmentExercise, AssessmentKind } from "@/lib/domain/assessments/entities";
import type { AssessmentSummary } from "@/lib/domain/assessments/rpc";
import type { Page } from "./groups";
import { callRpc, type RpcDb } from "./rpc";

// Assessments and their original exercises as the logged-in staff sees them. The database applies
// who may read or change what: a repo only translates names and types. The original is not
// sensitive, so none of these reads leaves an audit row.

export type NewAssessment = {
  kind: AssessmentKind;
  topic: string;
  generalInstructions: string;
  /** One per attempt, kept on a retry: the same key never creates the assessment twice. */
  opKey: string;
};

export async function createAssessment(db: RpcDb, groupId: string, input: NewAssessment): Promise<Written> {
  return callRpc(db, "create_assessment", {
    p_group_id: groupId,
    p_kind: input.kind,
    p_topic: input.topic,
    p_general_instructions: input.generalInstructions,
    p_op_key: input.opKey,
  });
}

/** `revision` is the one the caller read: a stale one is CONFLICT. */
export type AssessmentChanges = {
  revision: number;
  kind: AssessmentKind;
  topic: string;
  generalInstructions: string;
};

export async function updateAssessment(db: RpcDb, assessmentId: string, changes: AssessmentChanges): Promise<Written> {
  return callRpc(db, "update_assessment", {
    p_assessment_id: assessmentId,
    p_revision: changes.revision,
    p_kind: changes.kind,
    p_topic: changes.topic,
    p_general_instructions: changes.generalInstructions,
  });
}

export async function archiveAssessment(db: RpcDb, assessmentId: string, revision: number): Promise<Written> {
  return callRpc(db, "archive_assessment", { p_assessment_id: assessmentId, p_revision: revision });
}

export type AssessmentListOptions = { includeArchived?: boolean; limit?: number; offset?: number };

export async function listAssessments(
  db: RpcDb,
  groupId: string,
  options: AssessmentListOptions = {},
): Promise<Page<AssessmentSummary>> {
  return callRpc(db, "list_assessments", {
    p_group_id: groupId,
    p_include_archived: options.includeArchived,
    p_limit: options.limit,
    p_offset: options.offset,
  });
}

export type AssessmentDetail = { assessment: Assessment; exercises: AssessmentExercise[] };

export async function getAssessment(db: RpcDb, assessmentId: string): Promise<AssessmentDetail> {
  return callRpc(db, "get_assessment", { p_assessment_id: assessmentId });
}

export type NewExercise = {
  label: string;
  body: string;
  topicId?: string;
  /** One per attempt, kept on a retry: the same key never adds the exercise twice. */
  opKey: string;
};

export async function addExercise(db: RpcDb, assessmentId: string, input: NewExercise): Promise<Written> {
  return callRpc(db, "add_exercise", {
    p_assessment_id: assessmentId,
    p_label: input.label,
    p_body: input.body,
    p_op_key: input.opKey,
    p_topic_id: input.topicId,
  });
}

/** `revision` is the exercise's own: a stale one is CONFLICT. */
export type ExerciseChanges = { revision: number; label: string; body: string; topicId?: string };

export async function updateExercise(db: RpcDb, exerciseId: string, changes: ExerciseChanges): Promise<Written> {
  return callRpc(db, "update_exercise", {
    p_exercise_id: exerciseId,
    p_revision: changes.revision,
    p_label: changes.label,
    p_body: changes.body,
    p_topic_id: changes.topicId,
  });
}

export async function removeExercise(db: RpcDb, exerciseId: string, revision: number): Promise<Written> {
  return callRpc(db, "remove_exercise", { p_exercise_id: exerciseId, p_revision: revision });
}

/** `revision` is the assessment's; `exerciseIds` is the whole new order. */
export async function reorderExercises(
  db: RpcDb,
  assessmentId: string,
  order: { revision: number; exerciseIds: string[] },
): Promise<Written> {
  return callRpc(db, "reorder_exercises", {
    p_assessment_id: assessmentId,
    p_revision: order.revision,
    p_exercise_ids: order.exerciseIds,
  });
}
