import { z } from "zod";
import { DisplayName, Id, Revision, SubjectId, Timestamp } from "../common";

// Identity and membership (supabase/migrations/20261111130100_identity.sql). These schemas
// describe rows; RPC outputs are projections of them, declared next to each RPC.

export const INSTITUTION_KINDS = ["school", "sandbox"] as const;
export const InstitutionKind = z.enum(INSTITUTION_KINDS);
export type InstitutionKind = z.infer<typeof InstitutionKind>;

export const MEMBER_ROLES = ["admin", "teacher", "inclusion", "student"] as const;
export const MemberRole = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof MemberRole>;

/** Roles an invitation can carry: students are provisioned, never invited. */
export const InvitedRole = z.enum(["admin", "teacher", "inclusion"]);
export type InvitedRole = z.infer<typeof InvitedRole>;

export const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;

/** The short code students type at login. */
export const InstitutionCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,31}$/);

export const Institution = z.object({
  id: Id,
  name: z.string().trim().min(1).max(200),
  code: InstitutionCode,
  kind: InstitutionKind,
  expiresAt: Timestamp.nullable(),
  revision: Revision,
});
export type Institution = z.infer<typeof Institution>;

export const AppUser = z.object({
  id: Id,
  // Null for students (their name lives in students) and for the anonymous sandbox visitor.
  displayName: DisplayName.nullable(),
  revision: Revision,
});
export type AppUser = z.infer<typeof AppUser>;

export const Membership = z.object({
  id: Id,
  institutionId: Id,
  userId: Id,
  role: MemberRole,
  revokedAt: Timestamp.nullable(),
  revision: Revision,
});
export type Membership = z.infer<typeof Membership>;

export const Invitation = z.object({
  id: Id,
  institutionId: Id,
  email: z.email().max(254),
  role: InvitedRole,
  status: z.enum(INVITATION_STATUSES),
  expiresAt: Timestamp,
  revision: Revision,
});
export type Invitation = z.infer<typeof Invitation>;

export const Subject = z.object({ id: SubjectId, enabled: z.boolean() });
export type Subject = z.infer<typeof Subject>;
