import "server-only";
import type { Written } from "@/lib/domain/common";
import type { Consent, ConsentPurpose } from "@/lib/domain/students/records";
import { callRpc, type RpcDb } from "./rpc";

// Consents are per purpose. Recording one revokes the one in force for that purpose, so there is at
// most one. Reads are audited: wrap the client with withRequestId.

/** Every consent of the student, revoked ones too: the history. */
export async function listStudentConsents(db: RpcDb, studentId: string): Promise<Consent[]> {
  const { items } = await callRpc(db, "list_student_consents", {
    p_student_id: studentId,
  });
  return items;
}

export type NewConsent = {
  purpose: ConsentPurpose;
  /** Which approved text was signed. */
  textVersion: string;
  validUntil?: string;
  /** A ready consent form of this student. */
  fileId?: string;
};

/** The same consent again answers the one in force and writes nothing. */
export async function recordConsent(db: RpcDb, studentId: string, input: NewConsent): Promise<Written> {
  return callRpc(db, "record_consent", {
    p_student_id: studentId,
    p_purpose: input.purpose,
    p_text_version: input.textVersion,
    p_valid_until: input.validUntil,
    p_file_id: input.fileId,
  });
}

/** `revision` is the one the caller read: a stale one is CONFLICT. */
export async function revokeConsent(db: RpcDb, consentId: string, revision: number): Promise<Written> {
  return callRpc(db, "revoke_consent", {
    p_consent_id: consentId,
    p_revision: revision,
  });
}
