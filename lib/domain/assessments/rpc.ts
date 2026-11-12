import { z } from "zod";
import { Id, Limit, Offset, Revision, type RpcSpec, SubjectId, Timestamp, Written, page } from "../common";
import {
  Assessment,
  AssessmentExercise,
  AssessmentKind,
  AssessmentStatus,
  ExerciseBody,
  ExerciseLabel,
  GeneralInstructions,
  Topic,
} from "./entities";

// RPCs of assessments and original exercises (20261111131100_rpc_assessments.sql), owner T1.4a.
// The original is not sensitive: staff of the group read it without an audit row.

export const AssessmentSummary = z
  .object({
    id: Id,
    kind: AssessmentKind,
    topic: z.string(),
    subjectId: SubjectId,
    status: AssessmentStatus,
    publishAt: Timestamp.nullable(),
    dueAt: Timestamp.nullable(),
    exerciseCount: z.int().min(0),
    versionCount: z.int().min(0),
    createdAt: Timestamp,
    revision: Revision,
  })
  .strict();
export type AssessmentSummary = z.infer<typeof AssessmentSummary>;

const exerciseRevision = z.object({ p_exercise_id: Id, p_revision: Revision }).strict();
const assessmentRevision = z.object({ p_assessment_id: Id, p_revision: Revision }).strict();

export const ASSESSMENT_RPCS = {
  create_assessment: {
    args: z
      // p_op_key: one per attempt to create, reused on a retry (T1.F3).
      .object({ p_group_id: Id, p_kind: AssessmentKind, p_topic: Topic, p_general_instructions: GeneralInstructions, p_op_key: Id })
      .strict(),
    result: Written,
  },
  update_assessment: {
    args: assessmentRevision
      .extend({ p_kind: AssessmentKind, p_topic: Topic, p_general_instructions: GeneralInstructions })
      .strict(),
    result: Written,
  },
  archive_assessment: { args: assessmentRevision, result: Written },
  list_assessments: {
    args: z
      .object({
        p_group_id: Id,
        p_include_archived: z.boolean().optional(),
        p_limit: Limit.optional(),
        p_offset: Offset.optional(),
      })
      .strict(),
    result: page(AssessmentSummary),
  },
  get_assessment: {
    args: z.object({ p_assessment_id: Id }).strict(),
    result: z.object({ assessment: Assessment, exercises: z.array(AssessmentExercise) }).strict(),
  },
  add_exercise: {
    args: z
      .object({ p_assessment_id: Id, p_label: ExerciseLabel, p_body: ExerciseBody, p_op_key: Id, p_topic_id: Id.optional() })
      .strict(),
    result: Written,
  },
  update_exercise: {
    args: exerciseRevision
      .extend({ p_label: ExerciseLabel, p_body: ExerciseBody, p_topic_id: Id.optional() })
      .strict(),
    result: Written,
  },
  remove_exercise: { args: exerciseRevision, result: Written },
  reorder_exercises: {
    args: assessmentRevision.extend({ p_exercise_ids: z.array(Id).min(1).max(200) }).strict(),
    result: Written,
  },
} satisfies Record<string, RpcSpec>;
