import { z } from "zod";
import { Id, JsonObject, ReasonCode, Revision, type RpcSpec } from "../common";
import { AnswerKey, AnswerKeyContent, GenerationKind, OutputKind, OutputOutcome, ProfilesHash, VersionTag } from "./generations";

// RPCs of generations (T1.4d, internal: service_role only) and answer keys (T1.4e)
// (20261111131100_rpc_assessments.sql). inputs holds what is sent to the AI exactly as sent:
// redacted text, config, syllabus and subject. Never a student name or id.

/** Final states a caller may ask for; superseded is set only by a newer generation. */
export const FinishStatus = z.enum(["done", "failed", "cancelled"]);

const RevisionWritten = z.object({ revisionId: Id, number: z.int().min(1) }).strict();

export const GENERATION_RPCS = {
  internal_create_generation: {
    args: z
      .object({
        p_version_id: Id,
        p_kind: GenerationKind,
        p_op_key: Id,
        p_inputs: JsonObject,
        p_profiles_hash: ProfilesHash,
        p_profiles_revision: VersionTag,
        p_prompt_version: VersionTag,
        p_required_jobs: z.int().min(0).max(200),
        p_target_exercise_id: Id.optional(),
        p_requested_by: Id.optional(),
      })
      .strict(),
    // created is false when the op_key found the generation a double click already made.
    result: z.object({ id: Id, created: z.boolean() }).strict(),
  },
  internal_record_generation_output: {
    args: z
      .object({
        p_generation_id: Id,
        p_kind: OutputKind,
        p_output: JsonObject,
        p_version_exercise_id: Id.optional(),
      })
      .strict(),
    result: z.object({ outputId: Id, outcome: OutputOutcome }).strict(),
  },
  internal_finish_generation: {
    args: z.object({ p_generation_id: Id, p_status: FinishStatus, p_error_code: ReasonCode.optional() }).strict(),
    // changed is false when the generation had already finished: closing is idempotent.
    result: z.object({ id: Id, status: z.string(), changed: z.boolean() }).strict(),
  },
  internal_record_answer_key_revision: {
    args: z.object({ p_generation_id: Id, p_content: AnswerKeyContent }).strict(),
    result: RevisionWritten.extend({ outcome: OutputOutcome }).strict(),
  },
  get_answer_key: {
    args: z.object({ p_version_id: Id }).strict(),
    result: AnswerKey,
  },
  edit_answer_key: {
    // p_base_revision_id: the revision the teacher edited; omitted only for the very first key.
    args: z.object({ p_version_id: Id, p_content: AnswerKeyContent, p_base_revision_id: Id.optional() }).strict(),
    result: RevisionWritten,
  },
  confirm_answer_key: {
    args: z.object({ p_version_id: Id, p_base_revision_id: Id }).strict(),
    result: RevisionWritten,
  },
  approve_answer_key: {
    args: z.object({ p_version_id: Id, p_revision_id: Id }).strict(),
    result: z.object({ answerKeyId: Id, approvedRevisionId: Id, revision: Revision }).strict(),
  },
} satisfies Record<string, RpcSpec>;
