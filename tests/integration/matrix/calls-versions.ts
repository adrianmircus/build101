import { randomUUID } from "node:crypto";
import type { Scene } from "./fixtures";
import {
  OPTIONS,
  freshAssessment,
  freshVersion,
  gazeVersion,
  instructionsRevisionOf,
  readyVersion,
  revisionOf,
  type VersionFixture,
} from "./resources";
import type { CallsOf } from "./types";

// How to call the operations over versions (T1.4b, T1.4c) and, as service_role only, generations (T1.4d).

type VersionRpc =
  | "create_version" | "update_version_config" | "set_version_recipients" | "archive_version" | "list_versions"
  | "get_version" | "update_version_instructions" | "update_version_exercise" | "update_version_question"
  | "set_question_key" | "approve_version" | "reject_version" | "internal_create_generation"
  | "internal_record_generation_output" | "internal_finish_generation";

const CONFIG = JSON.stringify({ profiles: ["adhd"], supports: [], interests: [] });

function first(list: string[]): string {
  const [id] = list;
  if (id === undefined) throw new Error("Falta el elemento de la prueba.");
  return id;
}

async function atRevision(version: VersionFixture) {
  return { p_version_id: version.versionId, p_revision: await revisionOf("versions", version.versionId) };
}

async function draft(s: Scene): Promise<VersionFixture> {
  return freshVersion(s);
}

export const VERSION_CALLS: CallsOf<VersionRpc> = {
  create_version: async (s) => ({
    args: { p_assessment_id: (await freshAssessment(s)).id, p_config: CONFIG, p_answer_mode: "typed", p_op_key: randomUUID() },
  }),
  update_version_config: async (s) => ({ args: { ...(await atRevision(await draft(s))), p_config: CONFIG, p_answer_mode: "typed" } }),
  set_version_recipients: async (s) => ({
    args: { ...(await atRevision(await draft(s))), p_student_ids: [s.learner.studentId], p_op_id: randomUUID() },
  }),
  archive_version: async (s) => ({ args: await atRevision(await draft(s)) }),
  list_versions: async (s) => {
    const v = await draft(s);
    return { args: { p_assessment_id: v.assessmentId }, listing: true, target: v.versionId };
  },
  get_version: async (s) => ({ args: { p_version_id: (await draft(s)).versionId } }),
  update_version_instructions: async (s) => {
    const v = await draft(s);
    const revision = await instructionsRevisionOf(v.versionId);
    return { args: { p_version_id: v.versionId, p_revision: revision, p_general_instructions: "Instrucciones nuevas", p_op_id: randomUUID() } };
  },
  update_version_exercise: async (s) => {
    const id = first((await draft(s)).adapted);
    return { args: { p_version_exercise_id: id, p_revision: await revisionOf("version_exercises", id), p_body: "Texto adaptado", p_op_id: randomUUID() } };
  },
  update_version_question: async (s) => {
    const id = first((await gazeVersion(s)).questions);
    const options = JSON.stringify(OPTIONS);
    return { args: { p_question_id: id, p_revision: await revisionOf("version_questions", id), p_stem: "Elegí otra", p_options: options, p_op_id: randomUUID() } };
  },
  set_question_key: async (s) => ({ args: { p_question_id: first((await gazeVersion(s, false)).questions), p_correct_option_id: "A" } }),
  approve_version: async (s) => ({ args: { ...(await atRevision(await readyVersion(s))), p_op_id: randomUUID() } }),
  reject_version: async (s) => ({ args: { ...(await atRevision(await readyVersion(s))), p_reasons: ["demasiado_largo"], p_op_id: randomUUID() } }),
  internal_create_generation: async () => ({
    args: {
      p_version_id: randomUUID(), p_kind: "version", p_op_key: randomUUID(), p_inputs: "{}", p_profiles_hash: "a".repeat(64),
      p_profiles_revision: "r1", p_prompt_version: "p1", p_required_jobs: 1,
    },
  }),
  internal_record_generation_output: async () => ({ args: { p_generation_id: randomUUID(), p_kind: "exercise", p_output: "{}" } }),
  internal_finish_generation: async () => ({ args: { p_generation_id: randomUUID(), p_status: "done" } }),
};
