import { z } from "zod";
import { DisplayName, Id, ReasonCode, Revision, Timestamp } from "../common";

// Students, enrollments, pseudonyms and account provisioning (20261111130200_groups_students.sql).
// The display name is personal data: it is never sent to the AI and never logged.

/** Typed at login with the institution code: normalized before it reaches the database. */
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{1,39}$/);

/** The accessibility setting of a student: which tools the screen offers. The staff chooses it; it is not derived from the profile. */
export const STUDENT_INTERFACES = ["standard", "gaze", "voice"] as const;
export const StudentInterface = z.enum(STUDENT_INTERFACES);
export type StudentInterface = z.infer<typeof StudentInterface>;

export const Student = z.object({
  id: Id,
  institutionId: Id,
  displayName: DisplayName,
  username: Username,
  userId: Id.nullable(),
  // An accessibility setting the staff picks (api.set_student_interface), independent of the profile (T1.F8). The student reads their own, in StudentHome.
  interface: StudentInterface,
  archivedAt: Timestamp.nullable(),
  revision: Revision,
});
export type Student = z.infer<typeof Student>;

export const Enrollment = z.object({
  id: Id,
  groupId: Id,
  studentId: Id,
  startedAt: Timestamp,
  endedAt: Timestamp.nullable(),
});
export type Enrollment = z.infer<typeof Enrollment>;

/**
 * The pseudonym is the id of its row. Erasure unlinks it (studentId becomes null) before the
 * student is deleted; what stays attached to it is still personal data unless the inventory says,
 * field by field, that it was deleted or redacted (R3-7).
 */
export const StudentPseudonym = z.object({
  id: Id,
  studentId: Id.nullable(),
  unlinkedAt: Timestamp.nullable(),
});
export type StudentPseudonym = z.infer<typeof StudentPseudonym>;

export const PROVISIONING_STATUSES = ["pending", "active", "failed", "deleted", "not_applicable"] as const;

export const AccountProvisioning = z.object({
  id: Id,
  studentId: Id.nullable(),
  status: z.enum(PROVISIONING_STATUSES),
  attempts: z.int().min(0),
  errorCode: ReasonCode.nullable(),
  revision: Revision,
});
export type AccountProvisioning = z.infer<typeof AccountProvisioning>;
