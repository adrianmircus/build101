import { z } from "zod";
import { Created, DisplayName, Id, Limit, ReasonCode, Revision, type RpcSpec, SubjectId, Timestamp } from "../common";
import { InstitutionCode, InvitedRole } from "../identity/entities";
import { Username } from "../students/entities";
import { AccountRow, InstitutionSummary, InvitationStatus, InvitationView, RateLimitKey, StaffRow } from "./entities";

// RPCs of phase 2 (supabase/migrations/20261114100000_f2_contract.sql; docs/contratos/fase-2.md).
// args are keyed exactly like the SQL parameters. Results are camelCase like every RPC of phase 1.
// A bytea parameter travels through PostgREST as `\x<hex>`; the hash of a token is sha256, 32 bytes.

/** sha256(token) as PostgREST wants a bytea: `\x` and 64 hex digits. The server computes it; the browser never does. */
export const TokenHash = z.string().regex(/^\\x[0-9a-f]{64}$/);
/** The same hash inside a jsonb document, where there is no bytea: 64 hex digits, decoded by the RPC. */
export const TokenHashHex = z.string().regex(/^[0-9a-f]{64}$/);

const WindowSeconds = z.int().min(1).max(86400);
const EmailArg = z.string().trim().min(3).max(254);
const Keys = z.array(RateLimitKey).min(1).max(4);
const CreatedInvitation = z.object({ id: Id, expiresAt: Timestamp, sentAt: Timestamp.nullable(), revision: Revision, replayed: z.boolean() }).strict();

const ProvisioningStatus = z.enum(["pending", "active", "failed", "deleted"]);
const ProvisionedAccount = z
  .object({ studentId: Id, provisioningId: Id, status: ProvisioningStatus, authUserId: Id.nullable() })
  .strict();

const Issued = z.object({ studentId: Id, tokenHash: TokenHashHex }).strict();

export const ACCOUNT_RPCS = {
  // Session (T2.7).
  /** service_role: deletes the sessions of a user in auth.sessions (new card, changed password). */
  internal_revoke_user_sessions: { args: z.object({ p_user_id: Id }).strict(), result: z.object({ revoked: z.int().min(0) }).strict() },

  // Attempt limits (T2.7). p_limits[i] is the cap of p_keys[i]; the hit counts before Auth is tried.
  internal_rate_limit_hit: {
    args: z
      .object({ p_keys: Keys, p_limits: z.array(z.int().min(1)).min(1).max(4), p_window_seconds: WindowSeconds })
      .strict(),
    result: z.object({ allowed: z.boolean(), retryAt: Timestamp }).strict(),
  },
  internal_rate_limit_clear: { args: z.object({ p_keys: Keys }).strict(), result: z.object({ cleared: z.int().min(0) }).strict() },

  // Invitations (T2.3).
  create_invitation: {
    args: z.object({ p_institution_id: Id, p_email: EmailArg, p_role: InvitedRole, p_token_hash: TokenHash, p_op_key: Id }).strict(),
    result: CreatedInvitation,
  },
  resend_invitation: {
    args: z.object({ p_invitation_id: Id, p_revision: Revision, p_token_hash: TokenHash }).strict(),
    result: z.object({ id: Id, expiresAt: Timestamp, revision: Revision }).strict(),
  },
  revoke_invitation: { args: z.object({ p_invitation_id: Id, p_revision: Revision }).strict(), result: Created },
  /** Marks the email of the token of that revision as sent; a rotated token gives CONFLICT revision_mismatch. */
  mark_invitation_sent: { args: z.object({ p_invitation_id: Id, p_revision: Revision }).strict(), result: Created },
  list_invitations: {
    args: z.object({ p_institution_id: Id }).strict(),
    result: z.object({ items: z.array(InvitationView) }).strict(),
  },
  list_institution_staff: {
    args: z.object({ p_institution_id: Id }).strict(),
    result: z.object({ items: z.array(StaffRow) }).strict(),
  },
  /** The subjects with enabled = true, to choose the one of a new group. The Spanish name comes from the code catalog. */
  list_enabled_subjects: {
    args: z.object({}).strict(),
    result: z.object({ items: z.array(z.object({ id: SubjectId }).strict()) }).strict(),
  },
  get_institution_summary: { args: z.object({ p_institution_id: Id }).strict(), result: InstitutionSummary },
  /** service_role: the page of an invitation, opened by someone with no session yet. */
  internal_get_invitation: {
    args: z.object({ p_token_hash: TokenHash }).strict(),
    result: z
      .object({
        id: Id,
        institutionName: z.string(),
        role: InvitedRole,
        email: z.email(),
        inviterName: DisplayName.nullable(),
        status: InvitationStatus,
        expiresAt: Timestamp,
        hasAccount: z.boolean(),
      })
      .strict(),
  },
  /** service_role: only the admin command (T2.2); no actor, invited_by stays NULL. */
  internal_create_invitation: {
    args: z.object({ p_institution_id: Id, p_email: EmailArg, p_role: InvitedRole, p_token_hash: TokenHash }).strict(),
    result: z.object({ id: Id, expiresAt: Timestamp, revision: Revision }).strict(),
  },
  /** service_role: the atomic step of the signup by invitation: app_user, membership and acceptance in one transaction. */
  internal_finish_invitation_signup: {
    args: z.object({ p_token_hash: TokenHash, p_user_id: Id, p_display_name: DisplayName }).strict(),
    result: z.object({ institutionId: Id, role: InvitedRole }).strict(),
  },
  accept_invitation: {
    args: z.object({ p_token_hash: TokenHash }).strict(),
    result: z.object({ institutionId: Id, role: InvitedRole }).strict(),
  },

  // Student accounts (T2.5a).
  list_taken_usernames: {
    args: z.object({ p_institution_id: Id, p_bases: z.array(z.string().regex(/^[a-z0-9]{1,40}$/)).min(1).max(200) }).strict(),
    result: z.object({ items: z.array(z.string()) }).strict(),
  },
  list_group_accounts: {
    args: z.object({ p_group_id: Id }).strict(),
    result: z.object({ groupName: z.string(), institutionCode: InstitutionCode, items: z.array(AccountRow) }).strict(),
  },
  /** Starts an issue of cards (see «Emitir tarjetas»): the pending cards and the lease. The hashes are hex in the jsonb. */
  begin_access_cards: {
    args: z.object({ p_group_id: Id, p_cards: z.array(Issued).min(1).max(60), p_op_key: Id }).strict(),
    result: z
      .object({
        issueId: Id,
        leaseUntil: Timestamp,
        institutionCode: InstitutionCode,
        institutionName: z.string(),
        items: z.array(z.object({ studentId: Id, displayName: DisplayName, username: Username }).strict()),
      })
      .strict(),
  },
  /** The same actor that began closes the issue: the cards of those that went well become active. */
  finish_access_cards: {
    args: z.object({ p_issue_id: Id, p_done: z.array(Id).max(60) }).strict(),
    result: z.object({ activated: z.array(Id) }).strict(),
  },
  /** service_role: confirms under lock that the card is pending and the issue runs within its lease; extends the lease. */
  internal_claim_card_password: {
    args: z.object({ p_issue_id: Id, p_student_id: Id }).strict(),
    result: z
      .object({ ok: z.boolean(), provisioningId: Id.nullable(), status: ProvisioningStatus.nullable(), authUserId: Id.nullable() })
      .strict(),
  },
  /** service_role: up to 60 students, to know whose account to create or whose password to set. */
  /** service_role: takes the lease of the provisioning row under lock; ok false (with retryAt) when someone else holds it or the row is deleted. */
  internal_claim_provisioning: {
    args: z.object({ p_provisioning_id: Id }).strict(),
    result: z
      .object({
        ok: z.boolean(),
        retryAt: Timestamp.nullable(),
        status: ProvisioningStatus.nullable(),
        authUserId: Id.nullable(),
        leaseUntil: Timestamp.nullable(),
      })
      .strict(),
  },
  internal_get_student_accounts: {
    args: z.object({ p_student_ids: z.array(Id).min(1).max(60) }).strict(),
    result: z.object({ items: z.array(ProvisionedAccount) }).strict(),
  },
  internal_remember_student_account: {
    args: z.object({ p_provisioning_id: Id, p_auth_user_id: Id }).strict(),
    result: z.object({ authUserId: Id }).strict(),
  },
  /** Stores a code (ReasonCode), never a message. */
  internal_fail_student_account: {
    args: z.object({ p_provisioning_id: Id, p_error_code: ReasonCode }).strict(),
    result: z.object({ status: ProvisioningStatus, attempts: z.int().min(0) }).strict(),
  },
  internal_list_unfinished_accounts: {
    args: z.object({ p_limit: Limit }).strict(),
    result: z.object({ items: z.array(ProvisionedAccount) }).strict(),
  },
  internal_find_institution: {
    args: z.object({ p_code: InstitutionCode }).strict(),
    result: z.object({ code: InstitutionCode, name: z.string() }).strict(),
  },
  internal_resolve_student_login: {
    args: z.object({ p_code: InstitutionCode, p_username: Username }).strict(),
    result: z.object({ institutionFound: z.boolean(), authEmail: z.string().nullable() }).strict(),
  },
  /** No student name: the card only completes the school and the username. */
  internal_resolve_access_card: {
    args: z.object({ p_token_hash: TokenHash }).strict(),
    result: z.object({ institutionCode: InstitutionCode, institutionName: z.string(), username: Username }).strict(),
  },
} satisfies Record<string, RpcSpec>;
