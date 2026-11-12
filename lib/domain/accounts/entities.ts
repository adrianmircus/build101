import { z } from "zod";
import { DisplayName, Id, Timestamp } from "../common";
import { INVITATION_STATUSES, InstitutionCode, InstitutionKind, InvitedRole, MemberRole } from "../identity/entities";
import { Username } from "../students/entities";

// Types of phase 2 (docs/contratos/fase-2.md): who is asking, access cards, invitations and accounts.
// The RPC results that carry them are in rpc.ts; the pure rules (username, password, email) sit beside.

/** An institution of a staff actor, as list_my_institutions returns it. */
export const StaffInstitution = z.object({ id: Id, name: z.string(), kind: InstitutionKind, roles: z.array(MemberRole).min(1) }).strict();
export type StaffInstitution = z.infer<typeof StaffInstitution>;

/**
 * Who makes the request, read from the Supabase session (never from the demo cookie, never from the browser).
 * A staff actor has its institutions and roles; a student has the one institution it belongs to.
 */
export const Actor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("staff"), userId: Id, institutions: z.array(StaffInstitution) }).strict(),
  z.object({ kind: z.literal("student"), userId: Id, institutionId: Id }).strict(),
]);
export type Actor = z.infer<typeof Actor>;
export type StaffActor = Extract<Actor, { kind: "staff" }>;
export type StudentActor = Extract<Actor, { kind: "student" }>;

/**
 * One card to print. password and qrUrl exist only in the answer of the action that issued the card: they are
 * never stored, cached or logged. The student's name is for the sheet, never for the AI.
 */
export const AccessCard = z
  .object({
    studentId: Id,
    displayName: DisplayName,
    username: Username,
    institutionCode: z.string(),
    institutionName: z.string(),
    password: z.string().min(1),
    qrUrl: z.url(),
  })
  .strict();
export type AccessCard = z.infer<typeof AccessCard>;

/** The status an invitation has right now: a pending one past its expires_at reads as expired. */
export const InvitationStatus = z.enum(INVITATION_STATUSES);
export type InvitationStatus = z.infer<typeof InvitationStatus>;

/** A row of the invitations list of the institution panel (list_invitations). */
export const InvitationView = z
  .object({
    id: Id,
    email: z.email(),
    role: InvitedRole,
    status: InvitationStatus,
    expiresAt: Timestamp,
    sentAt: Timestamp.nullable(),
    invitedByName: DisplayName.nullable(),
    createdAt: Timestamp,
    revision: z.int().min(1),
  })
  .strict();
export type InvitationView = z.infer<typeof InvitationView>;

/** A member of the staff of an institution (list_institution_staff). */
export const StaffRow = z
  .object({
    userId: Id,
    displayName: DisplayName.nullable(),
    email: z.email(),
    roles: z.array(MemberRole).min(1),
    hasSignedIn: z.boolean(),
  })
  .strict();
export type StaffRow = z.infer<typeof StaffRow>;

export const ACCOUNT_STATUSES = ["pending", "active", "failed"] as const;
export const AccountStatus = z.enum(ACCOUNT_STATUSES);
export type AccountStatus = z.infer<typeof AccountStatus>;

/** The home of the panel of an institution (get_institution_summary). */
export const InstitutionSummary = z
  .object({
    id: Id,
    name: z.string(),
    code: InstitutionCode,
    staffCount: z.int().min(0),
    pendingInvitations: z.int().min(0),
    groupCount: z.int().min(0),
    studentCount: z.int().min(0),
  })
  .strict();
export type InstitutionSummary = z.infer<typeof InstitutionSummary>;

/** A student account of a group (list_group_accounts). Says nothing about the profile. */
export const AccountRow = z
  .object({
    studentId: Id,
    displayName: DisplayName,
    username: Username,
    accountStatus: AccountStatus,
    hasSignedIn: z.boolean(),
    lastCardAt: Timestamp.nullable(),
  })
  .strict();
export type AccountRow = z.infer<typeof AccountRow>;

/** A line of the "revisar" step: the name as pasted and the username the rules suggest (the admin can change it). */
export const UsernameDraft = z.object({ displayName: DisplayName, username: Username }).strict();
export type UsernameDraft = z.infer<typeof UsernameDraft>;

/** Counters of failed attempts (app.rate_limits). Keys are `<bucket>:<hex of HMAC-SHA256(RATE_LIMIT_SECRET, value)>`. */
export const RATE_LIMIT_BUCKETS = ["student_pair", "student_subject", "staff_pair", "staff_subject", "reset_email", "reset_ip", "token_ip"] as const;
export const RateLimitBucket = z.enum(RATE_LIMIT_BUCKETS);
export type RateLimitBucket = z.infer<typeof RateLimitBucket>;
export const RateLimitKey = z.string().regex(new RegExp(`^(?:${RATE_LIMIT_BUCKETS.join("|")}):[0-9a-f]{64}$`));
