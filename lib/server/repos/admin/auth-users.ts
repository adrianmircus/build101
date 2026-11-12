import "server-only";
import { unavailable } from "../../unavailable";

// The admin API of Supabase Auth (T2.3; T2.5b uses it, does not change it). Only with ids and emails that an RPC
// authorized first, and only from lib/server/services/admin/. Never logs an email, a password, a token or an id of a person.
// It uses only authAdmin() of repos/admin/db.ts (T2.7), whose client cuts every call at AUTH_TIMEOUT_MS. There is no call that
// updates a user: the Auth account of a student has no password and nobody changes its email (a database guard refuses it).

export const AUTH_TIMEOUT_MS = 5_000;

export type AuthUser = { id: string; email: string; appMetadata: Record<string, string> };
export type NewAuthUser = {
  id: string;
  email: string;
  /** Only for staff invited with a password; a student account is created without one. */
  password?: string | undefined;
  appMetadata: Record<string, string>;
  userMetadata?: Record<string, string> | undefined;
};

/** auth.admin.createUser with the given id and email_confirm: true. */
export async function createAuthUser(input: NewAuthUser): Promise<AuthUser> {
  return unavailable(input);
}

/** auth.admin.getUserById; null when Auth says it does not exist (404). Any other answer is an error. */
export async function getAuthUser(id: string): Promise<AuthUser | null> {
  return unavailable(id);
}

export async function deleteAuthUser(id: string): Promise<void> {
  return unavailable(id);
}

export type MagicLink = { hashedToken: string; userId: string; verificationType: string };
export type ExchangedSession = { accessToken: string; refreshToken: string; sessionId: string; userId: string };

/**
 * auth.admin.generateLink({ type: "magiclink", email }): returns the hashed_token, the id of the user it is for and the
 * verification_type. It sends no mail. The caller checks the id and the type before going on.
 */
export async function magicLinkToken(email: string): Promise<MagicLink> {
  return unavailable(email);
}

/** verifyOtp({ type: "magiclink", token_hash }) in a Supabase client with no cookies (persistSession: false): the tokens and the session_id. */
export async function exchangeMagicLink(tokenHash: string): Promise<ExchangedSession> {
  return unavailable(tokenHash);
}
