import { createHash, randomUUID } from "node:crypto";
import type { Scene } from "./fixtures";
import type { CallsOf } from "./types";

// How to call the operations of phase 2 (invitations, student accounts, attempt limits) over a scene.
// They are marked since: 2 in the matrix, so the phase 1 run skips them until T2.3, T2.5a and T2.7 land.
// Each ticket refines its calls (a real invitation, a card to issue) when it implements the RPC.

type AccountsRpc =
  | "internal_revoke_user_sessions"
  | "internal_rate_limit_hit"
  | "internal_rate_limit_clear"
  | "create_invitation"
  | "resend_invitation"
  | "revoke_invitation"
  | "mark_invitation_sent"
  | "list_invitations"
  | "list_institution_staff"
  | "get_institution_summary"
  | "list_enabled_subjects"
  | "internal_get_invitation"
  | "internal_create_invitation"
  | "internal_finish_invitation_signup"
  | "accept_invitation"
  | "list_taken_usernames"
  | "list_group_accounts"
  | "issue_access_cards"
  | "internal_get_student_accounts"
  | "internal_remember_student_account"
  | "internal_fail_student_account"
  | "internal_list_unfinished_accounts"
  | "internal_find_institution"
  | "internal_get_student_login"
  | "internal_bind_student_session"
  | "internal_resolve_access_card";

const PASSWORD_HASH = `scrypt$15$8$1$${Buffer.alloc(16, 1).toString("base64")}$${Buffer.alloc(64, 2).toString("base64")}`;
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
const bytea = () => `\\x${hash()}`;
const email = () => `invitada-${randomUUID().slice(0, 8)}@correo-de-prueba.invalid`;
const key = (bucket: string) => `${bucket}:${hash()}`;

export const ACCOUNT_CALLS: CallsOf<AccountsRpc> = {
  internal_revoke_user_sessions: async (s) => ({ args: { p_user_id: s.owner.userId } }),
  internal_rate_limit_hit: async () => ({ args: { p_keys: [key("student_pair")], p_limits: ["10"], p_window_seconds: 900 } }),
  internal_rate_limit_clear: async () => ({ args: { p_keys: [key("student_pair")] } }),
  create_invitation: async (s: Scene) => ({ args: { p_institution_id: s.institution.id, p_email: email(), p_role: "teacher", p_token_hash: bytea(), p_op_key: randomUUID() } }),
  resend_invitation: async () => ({ args: { p_invitation_id: randomUUID(), p_revision: 1, p_token_hash: bytea() } }),
  revoke_invitation: async () => ({ args: { p_invitation_id: randomUUID(), p_revision: 1 } }),
  mark_invitation_sent: async () => ({ args: { p_invitation_id: randomUUID(), p_revision: 1 } }),
  list_invitations: async (s) => ({ args: { p_institution_id: s.institution.id }, listing: true }),
  list_institution_staff: async (s) => ({ args: { p_institution_id: s.institution.id }, listing: true }),
  get_institution_summary: async (s) => ({ args: { p_institution_id: s.institution.id } }),
  internal_get_invitation: async () => ({ args: { p_token_hash: bytea() } }),
  internal_create_invitation: async (s) => ({ args: { p_institution_id: s.institution.id, p_email: email(), p_role: "teacher", p_token_hash: bytea() } }),
  internal_finish_invitation_signup: async (s) => ({ args: { p_token_hash: bytea(), p_user_id: s.owner.userId, p_display_name: "Docente nuevo" } }),
  accept_invitation: async () => ({ args: { p_token_hash: bytea() } }),
  list_taken_usernames: async (s) => ({ args: { p_institution_id: s.institution.id, p_bases: ["luciaf"] }, listing: true }),
  list_group_accounts: async (s) => ({ args: { p_group_id: s.groupId }, listing: true, target: s.learner.studentId }),
  issue_access_cards: async (s) => ({ args: { p_group_id: s.groupId, p_cards: JSON.stringify([{ studentId: s.learner.studentId, tokenHash: hash(), passwordHash: PASSWORD_HASH }]), p_op_key: randomUUID() } }),
  list_enabled_subjects: async () => ({ args: {}, listing: true }),
  internal_get_student_accounts: async (s) => ({ args: { p_student_ids: [s.learner.studentId] } }),
  internal_remember_student_account: async () => ({ args: { p_provisioning_id: randomUUID(), p_auth_user_id: randomUUID() } }),
  internal_fail_student_account: async () => ({ args: { p_provisioning_id: randomUUID(), p_error_code: "email_taken" } }),
  internal_list_unfinished_accounts: async () => ({ args: { p_limit: 10 } }),
  internal_find_institution: async () => ({ args: { p_code: "colegio-de-prueba" } }),
  internal_bind_student_session: async () => ({ args: { p_auth_user_id: randomUUID(), p_session_id: randomUUID(), p_version: 1 } }),
  internal_get_student_login: async () => ({ args: { p_code: "colegio-de-prueba", p_username: "luciaf" } }),
  internal_resolve_access_card: async () => ({ args: { p_token_hash: bytea() } }),
};
