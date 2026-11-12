import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { createSessionClient } from "../db/client";

// Every call to Supabase Auth made with the session of the user (the publishable key and the cookies), the only way
// layers.mjs lets db/client.ts be used. T2.1 writes getClaims; T2.3 writes the rest. None logs an email, a password or a
// token, and none returns the raw Auth error: a wrong credential is `null`, never a message.

export type SessionClaims = { userId: string; sessionId: string | null; email: string | null };
export type SignOutScope = "local" | "others" | "global";

const Claims = z.object({ sub: z.guid(), session_id: z.guid().optional(), email: z.string().optional() });

/**
 * The verified claims of the current session (getClaims), or null without a session: no cookie, an expired or forged
 * token, or Auth out of reach. Only the signature and the expiry are checked here; the database confirms that the
 * session is still alive on every RPC (app.rpc_begin).
 */
export async function getClaims(): Promise<SessionClaims | null> {
  const client = await createSessionClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data) return null;
  const claims = Claims.safeParse(data.claims);
  if (!claims.success) return null;
  return { userId: claims.data.sub, sessionId: claims.data.session_id ?? null, email: claims.data.email ?? null };
}

// Auth answers «wrong credentials», «expired link» or «weak password» with a 4xx. A network failure, a timeout, a 429 or a 5xx
// is not an answer about the person: it is an outage, and it never counts as a wrong password. The texts carry nothing that
// was sent, so they can reach the screen as they are.
const OUTAGE = "No pudimos completar esto ahora. Probá de nuevo en un momento.";
const BUSY = "Hubo muchos pedidos seguidos. Probá de nuevo en un minuto.";

type AuthFailure = { status?: number | undefined; name?: string | undefined };

function isOutage(error: AuthFailure): boolean {
  return error.status === undefined || error.status === 0 || error.status === 429 || error.status >= 500;
}

function outage(error: AuthFailure): AppError {
  return new AppError("UNAVAILABLE", error.status === 429 ? BUSY : OUTAGE);
}

const AccessClaims = z.object({ session_id: z.guid().optional() });

/** The claims of the session a sign in just opened. */
function claimsOf(session: { access_token: string; user: { id: string; email?: string | undefined } }): SessionClaims {
  const payload = Buffer.from(session.access_token.split(".")[1] ?? "", "base64url").toString("utf8");
  const claims = AccessClaims.safeParse(JSON.parse(payload));
  return { userId: session.user.id, sessionId: claims.success ? (claims.data.session_id ?? null) : null, email: session.user.email ?? null };
}

/** The answer of Auth, or an outage if the signal fires first: a login that outlives its deadline is dropped. */
async function until<T>(work: PromiseLike<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work;
  if (signal.aborted) throw new AppError("UNAVAILABLE", OUTAGE);
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new AppError("UNAVAILABLE", OUTAGE)), { once: true });
    work.then(resolve, reject);
  });
}

/** signInWithPassword; null when Auth refuses the pair (wrong email or password, or an account that cannot sign in). Leaves the session cookies. */
export async function signInWithPassword(email: string, password: string, options?: { signal?: AbortSignal }): Promise<SessionClaims | null> {
  const client = await createSessionClient();
  const { data, error } = await until(client.auth.signInWithPassword({ email, password }), options?.signal);
  if (error) {
    if (isOutage(error)) throw outage(error);
    return null;
  }
  return data.session ? claimsOf(data.session) : null;
}

/** Closes this session (local), the others of the same person (others) or all of them (global). With no session there is nothing to close. */
export async function signOut(scope: SignOutScope): Promise<void> {
  const client = await createSessionClient();
  const { error } = await client.auth.signOut({ scope });
  if (error && error.name !== "AuthSessionMissingError" && isOutage(error)) throw outage(error);
}

/** verifyOtp({ type: "recovery", token_hash }); the id of the verified user, or null when the link expired or was already used. Leaves a session. */
export async function verifyRecoveryOtp(tokenHash: string): Promise<string | null> {
  const client = await createSessionClient();
  const { data, error } = await client.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) {
    if (isOutage(error)) throw outage(error);
    return null;
  }
  return data.session ? data.session.user.id : null;
}

/** The tokens of a session that our server obtained without cookies (see exchangeMagicLink in repos/admin/auth-users.ts). */
export type SessionTokens = { accessToken: string; refreshToken: string };

/**
 * setSession with those tokens in the client of the request: leaves the cookies of the student. It is the last step of his login,
 * after internal_bind_student_session said ok. The tokens never leave the server except in those cookies, and are never logged.
 */
export async function setSessionTokens(tokens: SessionTokens): Promise<void> {
  const client = await createSessionClient();
  const { error } = await client.auth.setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
  if (!error) return;
  // The session is already registered (the bind said ok) but there is no cookie to carry it: the student tries again, with a new one.
  throw isOutage(error) ? outage(error) : new AppError("UNAVAILABLE", OUTAGE);
}

/** updateUser({ password }) for the current session. A password Auth does not accept is INVALID; with no session, FORBIDDEN. */
export async function updatePassword(password: string): Promise<void> {
  const client = await createSessionClient();
  const { error } = await client.auth.updateUser({ password });
  if (!error) return;
  if (error.status === 401 || error.status === 403 || error.name === "AuthSessionMissingError") {
    throw new AppError("FORBIDDEN", "Tu sesión terminó. Volvé a entrar.");
  }
  if (isOutage(error)) throw outage(error);
  throw new AppError("INVALID", "La contraseña no sirve: elegí otra de 10 caracteres como mínimo que no sea la que usabas.");
}

/**
 * resetPasswordForEmail: Auth sends the mail (template supabase/templates/recovery.html). An answer of 4xx (a mail that was
 * sent a moment ago, a limit of Auth) is dropped on purpose: whether it fails depends on the account existing, and the person
 * always reads the same text. An outage is thrown.
 */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const client = await createSessionClient();
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error && error.status !== 429 && isOutage(error)) throw outage(error);
}
