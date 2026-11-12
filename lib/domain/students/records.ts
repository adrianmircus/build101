import { z } from "zod";
import { Id, Revision, Timestamp } from "../common";

// Sensitive: private notes and consents (20261111130200 and 130300). Audited reads only.

export const NoteBody = z.string().trim().min(1).max(5000);

export const StudentNote = z
  .object({
    id: Id,
    studentId: Id,
    authorUserId: Id.nullable(),
    body: NoteBody,
    archivedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    revision: Revision,
  })
  .strict();
export type StudentNote = z.infer<typeof StudentNote>;

/** Consent is per purpose. Storing the profile is a purpose of its own, apart from the AI ones. */
export const CONSENT_PURPOSES = ["store_profile", "ai_adaptation", "ai_dictation", "ai_analysis"] as const;
export const ConsentPurpose = z.enum(CONSENT_PURPOSES);
export type ConsentPurpose = z.infer<typeof ConsentPurpose>;

export const CONSENT_STATUSES = ["granted", "revoked"] as const;

/** Which approved text was signed, for example "2026-11". */
export const ConsentTextVersion = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/);

export const Consent = z
  .object({
    id: Id,
    studentId: Id,
    purpose: ConsentPurpose,
    textVersion: ConsentTextVersion,
    status: z.enum(CONSENT_STATUSES),
    validFrom: Timestamp,
    validUntil: Timestamp.nullable(),
    revokedAt: Timestamp.nullable(),
    fileId: Id.nullable(),
    revision: Revision,
  })
  .strict();
export type Consent = z.infer<typeof Consent>;
