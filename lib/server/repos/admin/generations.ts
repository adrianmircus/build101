import "server-only";
import type { AnswerKeyContent, GenerationKind } from "@/lib/domain/assessments/generations";
import type { RpcArgs } from "@/lib/domain/rpc";
import { callRpc, type RpcDb } from "../rpc";

// The internal_* RPCs of generations (T1.4d, T1.4e). They need the admin client (service_role): only
// the bridge to the AI (T4.3) writes what the AI generated, never something the browser sends.
// `inputs` is what was sent to the AI exactly as sent: redacted text, never a student name or id.

type JsonObject = RpcArgs<"internal_create_generation">["p_inputs"];

export type NewGeneration = {
  kind: GenerationKind;
  /** One per attempt, kept on a retry: the same key never creates the generation twice. */
  opKey: string;
  inputs: JsonObject;
  /** SHA-256 of the approved profile files, their revision and the prompt version that were used. */
  profilesHash: string;
  profilesRevision: string;
  promptVersion: string;
  requiredJobs: number;
  /** The adapted exercise, for a generation of kind exercise. */
  targetExerciseId?: string;
  requestedBy?: string;
};

/** `created` is false when the opKey found the generation a double click already made. */
export async function createGeneration(
  admin: RpcDb,
  versionId: string,
  input: NewGeneration,
): Promise<{ id: string; created: boolean }> {
  return callRpc(admin, "internal_create_generation", {
    p_version_id: versionId,
    p_kind: input.kind,
    p_op_key: input.opKey,
    p_inputs: input.inputs,
    p_profiles_hash: input.profilesHash,
    p_profiles_revision: input.profilesRevision,
    p_prompt_version: input.promptVersion,
    p_required_jobs: input.requiredJobs,
    p_target_exercise_id: input.targetExerciseId,
    p_requested_by: input.requestedBy,
  });
}

export type GenerationOutput = {
  kind: "exercise" | "gaze_questions" | "instructions";
  /** The raw output of the AI, already validated by the caller. */
  output: JsonObject;
  /** Required for exercise and gaze_questions, and only for them. */
  versionExerciseId?: string;
};

export type OutputOutcome = "applied" | "obsolete" | "discarded";

/** Always keeps the output; `outcome` says whether it was applied. A retry answers what was decided then. */
export async function recordGenerationOutput(
  admin: RpcDb,
  generationId: string,
  output: GenerationOutput,
): Promise<{ outputId: string; outcome: OutputOutcome }> {
  return callRpc(admin, "internal_record_generation_output", {
    p_generation_id: generationId,
    p_kind: output.kind,
    p_output: output.output,
    p_version_exercise_id: output.versionExerciseId,
  });
}

export type GenerationEnd = { status: "done" | "failed" | "cancelled"; errorCode?: string };

/** `changed` is false when the generation had already finished: closing is idempotent. */
export async function finishGeneration(
  admin: RpcDb,
  generationId: string,
  end: GenerationEnd,
): Promise<{ id: string; status: string; changed: boolean }> {
  return callRpc(admin, "internal_finish_generation", {
    p_generation_id: generationId,
    p_status: end.status,
    p_error_code: end.errorCode,
  });
}

/** The key of an answer_key generation. It becomes the current one only if it still matches the version. */
export async function recordAnswerKeyRevision(
  admin: RpcDb,
  generationId: string,
  content: AnswerKeyContent,
): Promise<{ revisionId: string; number: number; outcome: OutputOutcome }> {
  return callRpc(admin, "internal_record_answer_key_revision", { p_generation_id: generationId, p_content: content });
}
