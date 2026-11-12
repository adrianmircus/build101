import "server-only";
import { unavailable } from "../../unavailable";

// The admin API of Supabase Auth (T2.3; T2.5b uses it, does not change it). Only with ids and emails that an RPC
// authorized first, and only from lib/server/services/admin/. Never logs an email, a password or an id of a person.
// Every call carries an AbortSignal of 5 seconds (AUTH_TIMEOUT_MS): the rule of the lease needs a request that
// is resolved or dead by then.

export const AUTH_TIMEOUT_MS = 5_000;

export type AuthUser = { id: string; email: string; appMetadata: Record<string, string> };
export type NewAuthUser = {
  id: string;
  email: string;
  password?: string;
  appMetadata: Record<string, string>;
  userMetadata?: Record<string, string>;
};
export type AuthUserChange = { password?: string; email?: string };
/** Defaults to AbortSignal.timeout(AUTH_TIMEOUT_MS). */
export type AuthCallOptions = { signal?: AbortSignal };

/** auth.admin.createUser with the given id and email_confirm: true. */
export async function createAuthUser(input: NewAuthUser, options?: AuthCallOptions): Promise<AuthUser> {
  return unavailable(input, options);
}

/** auth.admin.getUserById; null when it does not exist. */
export async function getAuthUser(id: string, options?: AuthCallOptions): Promise<AuthUser | null> {
  return unavailable(id, options);
}

/** auth.admin.updateUserById: the password, the email, or both (a new card changes both). */
export async function updateAuthUser(id: string, change: AuthUserChange, options?: AuthCallOptions): Promise<void> {
  return unavailable(id, change, options);
}

export async function deleteAuthUser(id: string, options?: AuthCallOptions): Promise<void> {
  return unavailable(id, options);
}
