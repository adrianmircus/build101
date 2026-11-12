import { randomUUID } from "node:crypto";
import { callRpc } from "@/lib/server/repos/rpc";
import type { Scene } from "./fixtures";
import { freshStudent } from "./resources";
import type { CallsOf } from "./types";

// How to call the operations over a student's needs, notes and consents (T1.3a, T1.3b).

type SensitiveRpc =
  | "set_student_needs" | "set_student_interface" | "get_student_needs" | "get_group_needs" | "list_student_need_events" | "list_student_notes"
  | "create_student_note" | "update_student_note" | "archive_student_note" | "list_student_consents" | "record_consent"
  | "revoke_consent";

/** A student of the target group with a profile already written, as the owner. */
async function withNeeds(s: Scene): Promise<string> {
  const student = await freshStudent(s);
  const needs = { p_student_id: student.id, p_profiles: ["adhd" as const], p_supports: [], p_interests: [], p_op_id: randomUUID() };
  await callRpc(s.owner.client, "set_student_needs", needs);
  return student.id;
}

async function noteOf(s: Scene) {
  const student = await freshStudent(s);
  const note = await callRpc(s.owner.client, "create_student_note", { p_student_id: student.id, p_body: "Nota de prueba", p_op_key: randomUUID() });
  return { studentId: student.id, noteId: note.id, revision: note.revision };
}

async function consentOf(s: Scene) {
  const student = await freshStudent(s);
  const consent = await callRpc(s.owner.client, "record_consent", { p_student_id: student.id, p_purpose: "store_profile", p_text_version: "v1" });
  return { studentId: student.id, consentId: consent.id, revision: consent.revision };
}

export const SENSITIVE_CALLS: CallsOf<SensitiveRpc> = {
  set_student_needs: async (s) => ({
    args: { p_student_id: (await freshStudent(s)).id, p_profiles: ["adhd"], p_supports: [], p_interests: [], p_op_id: randomUUID() },
  }),
  set_student_interface: async (s) => {
    const student = await freshStudent(s);
    return { args: { p_student_id: student.id, p_interface: "gaze", p_revision: student.revision } };
  },
  get_student_needs: async (s) => {
    const id = await withNeeds(s);
    return { args: { p_student_ids: [id] }, listing: true, target: id };
  },
  get_group_needs: async (s) => ({ args: { p_group_id: s.groupId }, listing: true, target: await withNeeds(s) }),
  list_student_need_events: async (s) => ({ args: { p_student_id: await withNeeds(s) }, listing: true }),
  list_student_notes: async (s) => {
    const note = await noteOf(s);
    return { args: { p_student_id: note.studentId }, listing: true, target: note.noteId };
  },
  create_student_note: async (s) => ({ args: { p_student_id: (await freshStudent(s)).id, p_body: "Otra nota", p_op_key: randomUUID() } }),
  update_student_note: async (s) => {
    const note = await noteOf(s);
    return { args: { p_note_id: note.noteId, p_revision: note.revision, p_body: "Nota cambiada" } };
  },
  archive_student_note: async (s) => {
    const note = await noteOf(s);
    return { args: { p_note_id: note.noteId, p_revision: note.revision } };
  },
  list_student_consents: async (s) => {
    const consent = await consentOf(s);
    return { args: { p_student_id: consent.studentId }, listing: true, target: consent.consentId };
  },
  record_consent: async (s) => ({ args: { p_student_id: (await freshStudent(s)).id, p_purpose: "store_profile", p_text_version: "v1" } }),
  revoke_consent: async (s) => {
    const consent = await consentOf(s);
    return { args: { p_consent_id: consent.consentId, p_revision: consent.revision } };
  },
};
