import { randomUUID } from "node:crypto";
import { callRpc } from "@/lib/server/repos/rpc";
import type { Scene } from "./fixtures";
import { approvedVersion, publishedVersion, revisionOf, submittedAttempt, type VersionFixture } from "./resources";
import type { CallsOf } from "./types";

// How to call the operations over answer keys (T1.4e), publishing, the student's attempts and
// grading (T1.5a to T1.5d).

type DeliveryRpc =
  | "internal_record_answer_key_revision" | "get_answer_key" | "edit_answer_key" | "confirm_answer_key"
  | "approve_answer_key" | "publish_version" | "student_open_attempt" | "student_start_attempt" | "student_save_draft"
  | "student_submit_attempt" | "list_assessment_attempts" | "get_attempt_for_grading" | "grade_attempt"
  | "student_home" | "student_task_list" | "student_task" | "student_grades";

function content(v: VersionFixture): string {
  return JSON.stringify({ exercises: Object.fromEntries(v.adapted.map((id) => [id, { answer: "Respuesta" }])), questions: {} });
}

/** A version with the first revision of its key written by the owner. */
async function keyed(s: Scene) {
  const v = await approvedVersion(s);
  const written = await callRpc(s.owner.client, "edit_answer_key", { p_version_id: v.versionId, p_content: JSON.parse(content(v)) });
  return { v, revisionId: written.revisionId };
}

async function confirmed(s: Scene) {
  const { v, revisionId } = await keyed(s);
  const next = await callRpc(s.owner.client, "confirm_answer_key", { p_version_id: v.versionId, p_base_revision_id: revisionId });
  return { v, revisionId: next.revisionId };
}

function exerciseResults(v: VersionFixture): string {
  return JSON.stringify(Object.fromEntries(v.adapted.map((id) => [id, { status: "correct", errors: [] }])));
}

export const DELIVERY_CALLS: CallsOf<DeliveryRpc> = {
  internal_record_answer_key_revision: async () => ({ args: { p_generation_id: randomUUID(), p_content: '{"exercises":{},"questions":{}}' } }),
  get_answer_key: async (s) => ({ args: { p_version_id: (await keyed(s)).v.versionId } }),
  edit_answer_key: async (s) => {
    const v = await approvedVersion(s);
    return { args: { p_version_id: v.versionId, p_content: content(v) } };
  },
  confirm_answer_key: async (s) => {
    const { v, revisionId } = await keyed(s);
    return { args: { p_version_id: v.versionId, p_base_revision_id: revisionId } };
  },
  approve_answer_key: async (s) => {
    const { v, revisionId } = await confirmed(s);
    return { args: { p_version_id: v.versionId, p_revision_id: revisionId } };
  },
  publish_version: async (s) => {
    const v = await approvedVersion(s);
    return { args: { p_version_id: v.versionId, p_revision: await revisionOf("versions", v.versionId), p_op_key: randomUUID() } };
  },
  student_open_attempt: async (s) => ({ args: { p_assignment_id: (await publishedVersion(s)).assignmentId } }),
  student_start_attempt: async (s) => ({ args: { p_attempt_id: (await publishedVersion(s)).attemptId } }),
  student_save_draft: async (s) => {
    const p = await publishedVersion(s);
    await callRpc(s.learner.client, "student_start_attempt", { p_attempt_id: p.attemptId });
    const answers = JSON.stringify(Object.fromEntries(p.adapted.map((id) => [id, { text: "Respuesta", mode: "typed" }])));
    return { args: { p_attempt_id: p.attemptId, p_revision: 1, p_answers: answers, p_choices: "{}" } };
  },
  student_submit_attempt: async (s) => {
    const p = await publishedVersion(s);
    await callRpc(s.learner.client, "student_start_attempt", { p_attempt_id: p.attemptId });
    return { args: { p_attempt_id: p.attemptId, p_revision: 1 } };
  },
  list_assessment_attempts: async (s) => {
    const p = await publishedVersion(s);
    return { args: { p_assessment_id: p.assessmentId }, listing: true, target: s.learner.studentId };
  },
  get_attempt_for_grading: async (s) => ({ args: { p_attempt_id: (await submittedAttempt(s)).attemptId } }),
  grade_attempt: async (s) => {
    const p = await submittedAttempt(s);
    return { args: { p_attempt_id: p.attemptId, p_feedback: "Bien", p_exercise_results: exerciseResults(p), p_score: 7 } };
  },
  student_home: async (s) => ({ args: {}, listing: true, target: s.groupId, sharedWithPeers: true }),
  student_task_list: async (s) => ({ args: {}, listing: true, target: (await publishedVersion(s)).attemptId }),
  student_task: async (s) => ({ args: { p_attempt_id: (await publishedVersion(s)).attemptId } }),
  student_grades: async () => ({ args: {}, listing: true }),
};
