import "server-only";
import { z } from "zod";
import { authAdmin, otpExchangeClient } from "./db";

// The admin API of Supabase Auth (T2.3; T2.5b uses it, does not change it). Only with ids and emails that an RPC
// authorized first, and only from lib/server/services/admin/. Never logs an email, a password, a token or an id of a person.
// It uses only authAdmin() and otpExchangeClient() of repos/admin/db.ts (T2.7, T2.3), whose clients cut every call at
// AUTH_TIMEOUT_MS. There is no call that updates a user: the Auth account of a student has no password and nobody changes its
// email (a database guard refuses it).

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

/**
 * Why a call to Auth failed, with nothing of what was sent: `exists` (the email or the id is taken), `weak_password` (Auth refused
 * the password), `rate_limited` (429), `invalid` (the token is wrong, expired or used) and `unavailable` (Auth did not answer
 * in time, or answered an error that is not about what we sent). The service decides what the person is told.
 */
export class AuthAdminError extends Error {
  readonly kind: "exists" | "weak_password" | "rate_limited" | "invalid" | "unavailable";

  constructor(kind: AuthAdminError["kind"]) {
    super("Falló una llamada a Supabase Auth.");
    this.name = "AuthAdminError";
    this.kind = kind;
  }
}

type AuthFailure = { status?: number | undefined; code?: string | undefined };

const KIND_BY_CODE: Record<string, AuthAdminError["kind"]> = {
  email_exists: "exists",
  user_already_exists: "exists",
  phone_exists: "exists",
  weak_password: "weak_password",
  over_request_rate_limit: "rate_limited",
};
const ABOUT_WHAT_WE_SENT = new Set([400, 401, 403, 404, 422]);

function classify(error: AuthFailure): AuthAdminError {
  const byCode = error.code === undefined ? undefined : KIND_BY_CODE[error.code];
  if (byCode !== undefined) return new AuthAdminError(byCode);
  if (error.status === 429) return new AuthAdminError("rate_limited");
  return new AuthAdminError(error.status !== undefined && ABOUT_WHAT_WE_SENT.has(error.status) ? "invalid" : "unavailable");
}

const Metadata = z.record(z.string(), z.unknown());

function asAuthUser(user: { id: string; email?: string | undefined; app_metadata: unknown }): AuthUser {
  const metadata = Metadata.safeParse(user.app_metadata);
  const strings = Object.entries(metadata.success ? metadata.data : {}).flatMap(([key, value]) => (typeof value === "string" ? [[key, value] as const] : []));
  return { id: user.id, email: user.email ?? "", appMetadata: Object.fromEntries(strings) };
}

/** auth.admin.createUser with the given id and email_confirm: true. */
export async function createAuthUser(input: NewAuthUser): Promise<AuthUser> {
  const { data, error } = await authAdmin().createUser({
    id: input.id,
    email: input.email,
    ...(input.password === undefined ? {} : { password: input.password }),
    email_confirm: true,
    app_metadata: input.appMetadata,
    ...(input.userMetadata === undefined ? {} : { user_metadata: input.userMetadata }),
  });
  if (error || !data.user) throw classify(error ?? {});
  return asAuthUser(data.user);
}

/** auth.admin.getUserById; null when Auth says it does not exist (404). Any other answer is an error. */
export async function getAuthUser(id: string): Promise<AuthUser | null> {
  const { data, error } = await authAdmin().getUserById(id);
  if (error) {
    if (error.status === 404 || error.code === "user_not_found") return null;
    throw classify(error);
  }
  return data.user ? asAuthUser(data.user) : null;
}

/** A hard delete (`shouldSoftDelete: false`): the soft one rewrites the email. An account that is already gone is fine. */
export async function deleteAuthUser(id: string): Promise<void> {
  const { error } = await authAdmin().deleteUser(id, false);
  if (error && error.status !== 404 && error.code !== "user_not_found") throw classify(error);
}

export type MagicLink = { hashedToken: string; userId: string; verificationType: string };
export type ExchangedSession = { accessToken: string; refreshToken: string; sessionId: string; userId: string };

/**
 * auth.admin.generateLink({ type: "magiclink", email }): returns the hashed_token, the id of the user it is for and the
 * verification_type. It sends no mail. The caller checks the id and the type before going on.
 */
export async function magicLinkToken(email: string): Promise<MagicLink> {
  const { data, error } = await authAdmin().generateLink({ type: "magiclink", email });
  if (error) throw classify(error);
  const { properties, user } = data;
  if (!user || !properties.hashed_token || !properties.verification_type) throw new AuthAdminError("unavailable");
  return { hashedToken: properties.hashed_token, userId: user.id, verificationType: properties.verification_type };
}

const SessionClaims = z.object({ session_id: z.guid() });

function sessionIdOf(accessToken: string): string {
  try {
    const payload = Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8");
    const claims = SessionClaims.safeParse(JSON.parse(payload));
    if (claims.success) return claims.data.session_id;
  } catch {
    // A token that does not decode is the same as one with no session_id: the exchange failed.
  }
  throw new AuthAdminError("unavailable");
}

/** verifyOtp({ type: "magiclink", token_hash }) in a Supabase client with no cookies (persistSession: false): the tokens and the session_id. */
export async function exchangeMagicLink(tokenHash: string): Promise<ExchangedSession> {
  const { data, error } = await otpExchangeClient().auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  const session = data.session;
  if (error || !session) throw classify(error ?? {});
  return { accessToken: session.access_token, refreshToken: session.refresh_token, sessionId: sessionIdOf(session.access_token), userId: session.user.id };
}
