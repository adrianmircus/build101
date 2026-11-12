import { z } from "zod";
import { DisplayName, Id, Revision, Timestamp } from "../common";
import { InstitutionCode, InvitedRole } from "../identity/entities";
import { Username } from "../students/entities";
import { AccessCard, InvitationStatus } from "./entities";

// What the services of phase 2 answer, and so what the Server Actions return inside a Result.
// Nothing here carries a token, a hash or a profile.

/**
 * The recovery link was valid and left a session; the screen can ask for the new password. `userId` is the account that was verified:
 * the screen sends it back with the new password, and the server changes nothing if the session now belongs to somebody else.
 */
export const RecoveryVerified = z.object({ verified: z.literal(true), userId: Id }).strict();
export type RecoveryVerified = z.infer<typeof RecoveryVerified>;

/** Where to go after a sign in or a sign out; the server decides, the browser only navigates. */
export const NextStep = z.object({ next: z.string().startsWith("/") }).strict();
export type NextStep = z.infer<typeof NextStep>;

/** Asking for a reset always answers the same, whether the email exists or not. */
export const ResetRequested = z.object({ sent: z.literal(true) }).strict();
export type ResetRequested = z.infer<typeof ResetRequested>;

export const INVITE_OUTCOMES = ["sent", "mail_failed", "already_member", "invitation_pending", "invalid_email"] as const;
export const InviteOutcome = z.enum(INVITE_OUTCOMES);
export type InviteOutcome = z.infer<typeof InviteOutcome>;

/** One line of inviteStaff, in the order the emails came: the others go on when one fails. */
export const InviteRowResult = z
  .object({ email: z.string(), outcome: InviteOutcome, invitationId: Id.nullable(), expiresAt: Timestamp.nullable() })
  .strict();
export type InviteRowResult = z.infer<typeof InviteRowResult>;

export const InvitationResent = z.object({ id: Id, expiresAt: Timestamp, revision: Revision, mailSent: z.boolean() }).strict();
export type InvitationResent = z.infer<typeof InvitationResent>;

/** Who is looking at the invitation: nobody signed in, the invited email, or somebody else (shows «No es el correo con el que entraste»). */
export const SESSION_RELATIONS = ["none", "same", "other"] as const;

/** What the page of an invitation shows to someone with no session yet. */
export const InvitationPublic = z
  .object({
    institutionName: z.string(),
    role: InvitedRole,
    email: z.email(),
    inviterName: DisplayName.nullable(),
    status: InvitationStatus,
    expiresAt: Timestamp,
    hasAccount: z.boolean(),
    relation: z.enum(SESSION_RELATIONS),
  })
  .strict();
export type InvitationPublic = z.infer<typeof InvitationPublic>;

export const Accepted = z.object({ institutionId: Id, role: InvitedRole, next: z.string().startsWith("/") }).strict();
export type Accepted = z.infer<typeof Accepted>;


/**
 * One line of createStudentAccounts, by the index of the row it came in. `uncertain`: the call died without saying whether the student
 * was created (a lost answer): retry with the same opKey and the same `slot` and the server answers the one that already exists.
 */
export const ACCOUNT_OUTCOMES = ["created", "username_taken", "failed", "uncertain"] as const;
export const CreatedAccountRow = z
  .object({ index: z.int().min(0), outcome: z.enum(ACCOUNT_OUTCOMES), studentId: Id.nullable() })
  .strict();
export type CreatedAccountRow = z.infer<typeof CreatedAccountRow>;

/** Why a student got no card: failed (his account could not be created) or uncertain (Auth did not confirm; try again right away). */
export const CARD_OUTCOMES = ["failed", "uncertain"] as const;
export const OtherCard = z.object({ studentId: Id, outcome: z.enum(CARD_OUTCOMES) }).strict();
export type OtherCard = z.infer<typeof OtherCard>;

/** The cards that came out well, and the others with why. */
export const IssuedCards = z.object({ cards: z.array(AccessCard), others: z.array(OtherCard) }).strict();
export type IssuedCards = z.infer<typeof IssuedCards>;

export const ReconcileSummary = z.object({ done: z.int().min(0), failed: z.int().min(0) }).strict();
export type ReconcileSummary = z.infer<typeof ReconcileSummary>;

/** The school and the username of a card or of a remembered school: never a student name. */
export const SchoolAndUser = z.object({ institutionCode: InstitutionCode, institutionName: z.string(), username: Username }).strict();
export type SchoolAndUser = z.infer<typeof SchoolAndUser>;

export const FoundInstitution = z.object({ code: InstitutionCode, name: z.string() }).strict();
export type FoundInstitution = z.infer<typeof FoundInstitution>;
