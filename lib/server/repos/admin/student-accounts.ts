import "server-only";
import type { RpcResult } from "@/lib/domain/rpc";
import { callRpc, type RpcDb } from "../rpc";

// The internal_* RPCs of the student accounts (T2.5a) that need the admin client (service_role). Only the services of
// lib/server/services/admin/ use them, with ids that an RPC called with the session of the actor already authorized (or, for the
// login, that nobody sends: they come out of the database). None logs an id, a hash or a username.

export type ProvisionedAccount = RpcResult<"internal_get_student_accounts">["items"][number];
export type RememberedAccount = RpcResult<"internal_remember_student_account">;
export type StudentLogin = RpcResult<"internal_get_student_login">;

/** The provisioning rows of up to 60 students (a sandbox row is not listed). */
export async function getStudentAccounts(admin: RpcDb, studentIds: string[]): Promise<ProvisionedAccount[]> {
  const { items } = await callRpc(admin, "internal_get_student_accounts", { p_student_ids: studentIds });
  return items;
}

/** Keeps the Auth id of the account: the one given if there was none, the stored one if there was. `ok: false` when the row is `deleted`. */
export async function rememberStudentAccount(admin: RpcDb, provisioningId: string, authUserId: string): Promise<RememberedAccount> {
  return callRpc(admin, "internal_remember_student_account", { p_provisioning_id: provisioningId, p_auth_user_id: authUserId });
}

/** `pending` or `failed` becomes `failed` with a code (never a message); an `active` or `deleted` row is not touched. */
export async function failStudentAccount(admin: RpcDb, provisioningId: string, errorCode: string): Promise<{ status: string; attempts: number }> {
  return callRpc(admin, "internal_fail_student_account", { p_provisioning_id: provisioningId, p_error_code: errorCode });
}

/** What `reconcile` takes up: provisionings that started and did not finish, and active accounts that are gone from Auth. */
export async function listUnfinishedAccounts(admin: RpcDb, limit: number): Promise<ProvisionedAccount[]> {
  const { items } = await callRpc(admin, "internal_list_unfinished_accounts", { p_limit: limit });
  return items;
}

/** Registers a session of Auth as the one our server opened for this student, if the version of his credential is still the same. */
export async function bindStudentSession(admin: RpcDb, input: { authUserId: string; sessionId: string; version: number }): Promise<boolean> {
  const { ok } = await callRpc(admin, "internal_bind_student_session", {
    p_auth_user_id: input.authUserId,
    p_session_id: input.sessionId,
    p_version: input.version,
  });
  return ok;
}

/** The school with that code (never a sandbox), or null. */
export async function findInstitution(admin: RpcDb, code: string): Promise<{ code: string; name: string } | null> {
  try {
    return await callRpc(admin, "internal_find_institution", { p_code: code });
  } catch (thrown) {
    if (isNotFound(thrown)) return null;
    throw thrown;
  }
}

/** The only place the hash of a password comes out of the database. */
export async function getStudentLogin(admin: RpcDb, code: string, username: string): Promise<StudentLogin> {
  return callRpc(admin, "internal_get_student_login", { p_code: code, p_username: username });
}

/** The school and the username of a card that is current; null for any card that is not (revoked, unknown, archived student, sandbox). */
export async function resolveAccessCard(admin: RpcDb, tokenHash: string): Promise<RpcResult<"internal_resolve_access_card"> | null> {
  try {
    return await callRpc(admin, "internal_resolve_access_card", { p_token_hash: tokenHash });
  } catch (thrown) {
    if (isNotFound(thrown)) return null;
    throw thrown;
  }
}

function isNotFound(thrown: unknown): boolean {
  return typeof thrown === "object" && thrown !== null && Reflect.get(thrown, "code") === "NOT_FOUND";
}
