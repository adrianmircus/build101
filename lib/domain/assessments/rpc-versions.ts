import { z } from "zod";
import { Id, Revision, type RpcSpec, Written } from "../common";
import {
  AnswerMode,
  OptionId,
  OptionList,
  QuestionKey,
  VERSION_STATUSES,
  Version,
  VersionConfig,
  VersionExercise,
  VersionQuestion,
  VersionRecipient,
} from "./versions";

// RPCs of versions (20261111131100_rpc_assessments.sql): T1.4b configuration and recipients,
// T1.4c content and approval. list_versions is the only listing staff use without an audit row,
// so it carries neither config, nor answer mode, nor recipients.

export const VersionSummary = z
  .object({
    id: Id,
    position: z.int().min(1),
    status: z.enum(VERSION_STATUSES),
    stale: z.boolean(),
    approved: z.boolean(),
    exerciseCount: z.int().min(0),
    readyCount: z.int().min(0),
    revision: Revision,
  })
  .strict();
export type VersionSummary = z.infer<typeof VersionSummary>;

/**
 * Audited: the teacher's review of one version. keys carries each question's correct option with
 * the revision set_question_key needs for its CAS after a reload; never reaches a student.
 */
export const VersionDetail = z
  .object({
    version: Version,
    recipients: z.array(VersionRecipient),
    exercises: z.array(VersionExercise),
    questions: z.array(VersionQuestion),
    keys: z.array(QuestionKey),
  })
  .strict();
export type VersionDetail = z.infer<typeof VersionDetail>;

const RejectReason = z.string().regex(/^[a-z][a-z_]{1,40}$/);

/** An edit of the content returns its own revision and the version's, which moved too. */
const ContentWritten = z.object({ id: Id, revision: Revision, versionRevision: Revision }).strict();
const versionRevision = z.object({ p_version_id: Id, p_revision: Revision }).strict();

export const VERSION_RPCS = {
  update_version_instructions: {
    // p_revision is the version's instructionsRevision.
    args: z
      .object({ p_version_id: Id, p_revision: Revision, p_general_instructions: z.string().max(5000), p_op_id: Id })
      .strict(),
    result: z.object({ id: Id, instructionsRevision: Revision, versionRevision: Revision }).strict(),
  },
  create_version: {
    args: z
      // p_op_key: one per attempt to create, reused on a retry (T1.F3).
      .object({ p_assessment_id: Id, p_config: VersionConfig, p_answer_mode: AnswerMode, p_op_key: Id, p_base_version_id: Id.optional() })
      .strict(),
    result: z.object({ id: Id, revision: Revision, position: z.int().min(1) }).strict(),
  },
  update_version_config: {
    args: versionRevision.extend({ p_config: VersionConfig, p_answer_mode: AnswerMode }).strict(),
    result: Written,
  },
  set_version_recipients: {
    args: versionRevision.extend({ p_student_ids: z.array(Id).max(200), p_op_id: Id }).strict(),
    result: Written,
  },
  archive_version: { args: versionRevision, result: Written },
  list_versions: {
    args: z.object({ p_assessment_id: Id }).strict(),
    result: z.object({ items: z.array(VersionSummary) }).strict(),
  },
  get_version: {
    args: z.object({ p_version_id: Id }).strict(),
    result: VersionDetail,
  },
  update_version_exercise: {
    args: z
      .object({ p_version_exercise_id: Id, p_revision: Revision, p_body: z.string().max(20000), p_op_id: Id })
      .strict(),
    result: ContentWritten,
  },
  update_version_question: {
    args: z
      .object({
        p_question_id: Id,
        p_revision: Revision,
        p_stem: z.string().min(1).max(5000),
        p_options: OptionList,
        p_op_id: Id,
      })
      .strict(),
    result: ContentWritten,
  },
  set_question_key: {
    args: z.object({ p_question_id: Id, p_correct_option_id: OptionId, p_revision: Revision.optional() }).strict(),
    result: z.object({ questionId: Id, revision: Revision }).strict(),
  },
  approve_version: {
    args: versionRevision.extend({ p_op_id: Id }).strict(),
    result: z.object({ id: Id, approvedRevision: Revision }).strict(),
  },
  reject_version: {
    // Reasons are ids of the rejection catalogue (today lib/feedback/reasons.ts).
    args: versionRevision.extend({ p_reasons: z.array(RejectReason).min(1).max(10), p_op_id: Id }).strict(),
    result: z.object({ eventId: Id }).strict(),
  },
} satisfies Record<string, RpcSpec>;
