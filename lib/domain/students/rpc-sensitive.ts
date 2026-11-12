import { z } from "zod";
import { DateOnly, Id, Limit, Offset, Revision, type RpcSpec, Timestamp, Written, page } from "../common";
import { Interest, ProfileId, StudentNeedEvent, StudentNeeds, SupportId } from "./needs";
import { Consent, ConsentPurpose, ConsentTextVersion, NoteBody, StudentNote } from "./records";

// RPCs of the student's sensitive data (20261111131000_rpc_identity_groups.sql).
// Needs are T1.3a, notes and consents T1.3b. Every read writes one audit_log row per request with
// the set of students disclosed, and is never cached on the server.

const studentOnly = z.object({ p_student_id: Id }).strict();

export const SENSITIVE_RPCS = {
  set_student_needs: {
    args: z
      .object({
        p_student_id: Id,
        p_profiles: z.array(ProfileId).max(10),
        p_supports: z.array(SupportId).max(10),
        p_interests: z.array(Interest).max(10),
        p_op_id: Id,
        // Omitted when the student has no needs row yet.
        p_revision: Revision.optional(),
        p_review_due_on: DateOnly.optional(),
      })
      .strict(),
    result: z.object({ studentId: Id, revision: Revision }).strict(),
  },
  get_student_needs: {
    args: z.object({ p_student_ids: z.array(Id).min(1).max(200) }).strict(),
    result: z.object({ items: z.array(StudentNeeds) }).strict(),
  },
  get_group_needs: {
    args: z.object({ p_group_id: Id }).strict(),
    result: z.object({ items: z.array(StudentNeeds) }).strict(),
  },
  list_student_need_events: {
    args: studentOnly.extend({ p_limit: Limit.optional(), p_offset: Offset.optional() }).strict(),
    result: page(StudentNeedEvent),
  },
  list_student_notes: {
    args: studentOnly,
    result: z.object({ items: z.array(StudentNote) }).strict(),
  },
  create_student_note: {
    args: z.object({ p_student_id: Id, p_body: NoteBody }).strict(),
    result: Written,
  },
  update_student_note: {
    args: z.object({ p_note_id: Id, p_revision: Revision, p_body: NoteBody }).strict(),
    result: Written,
  },
  archive_student_note: {
    args: z.object({ p_note_id: Id, p_revision: Revision }).strict(),
    result: Written,
  },
  list_student_consents: {
    args: studentOnly,
    result: z.object({ items: z.array(Consent) }).strict(),
  },
  record_consent: {
    args: z
      .object({
        p_student_id: Id,
        p_purpose: ConsentPurpose,
        p_text_version: ConsentTextVersion,
        p_valid_until: Timestamp.optional(),
        p_file_id: Id.optional(),
      })
      .strict(),
    result: Written,
  },
  revoke_consent: {
    args: z.object({ p_consent_id: Id, p_revision: Revision }).strict(),
    result: Written,
  },
} satisfies Record<string, RpcSpec>;
