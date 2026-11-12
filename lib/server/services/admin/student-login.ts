import "server-only";
import { studentEmail } from "@/lib/domain/accounts/email";
import type { FoundInstitution, SchoolAndUser } from "@/lib/domain/accounts/results";
import type { RpcResult } from "@/lib/domain/rpc";
import { AppError } from "@/lib/errors";
import { log } from "../../log";
import { AuthAdminError, type ExchangedSession, exchangeMagicLink, magicLinkToken } from "../../repos/admin/auth-users";
import { adminDb } from "../../repos/admin/db";
import * as accounts from "../../repos/admin/student-accounts";
import type { SessionTokens } from "../../repos/auth-session";

// What the login of the students needs before anyone has a session (T2.5b), with the admin client. The password hash comes
// out of the database only here, and only to be checked in the server: it is never returned to a page or an action.
// Nothing here logs a token, a hash, a password, a username or an id of Auth.

export type StudentLoginData = RpcResult<"internal_get_student_login">;

const BUSY = "Probá de nuevo en un minuto.";
const OUTAGE = "No pudimos abrir tu sesión ahora. No es por vos: probá de nuevo en un momento.";

/**
 * Auth answered 429 while the session of a student was being opened. The password was already checked and was right, so the caller
 * counts it as a success (it clears the counters of the subject) and the retry is not blocked by ours (F2C-63, F2C-69).
 */
export class AuthBusyError extends AppError {
  constructor() {
    super("UNAVAILABLE", BUSY);
    this.name = "AuthBusyError";
  }
}

/** Only for tests: a place to stop the flow between its steps, to play a card that is issued right in the middle. */
export type OpenSessionHooks = { beforeBind?: () => Promise<void> };

/** internal_get_student_login: authUserId and passwordHash only for an active, not archived student with a credential. */
export async function studentLogin(code: string, username: string): Promise<StudentLoginData> {
  return accounts.getStudentLogin(adminDb(), code, username);
}

/** What the person is told when Auth fails while opening the session: busy is its own case, the rest is an outage of ours. */
function failure(error: unknown): never {
  if (!(error instanceof AuthAdminError)) throw error;
  log.warn("student_login.auth_failed", { outcome: error.kind });
  throw error.kind === "rate_limited" ? new AuthBusyError() : new AppError("UNAVAILABLE", OUTAGE);
}

/** generateLink for his synthetic email: the hashed token, or null when the link is for another user or of another kind. */
async function linkFor(authUserId: string): Promise<string | null> {
  try {
    const link = await magicLinkToken(studentEmail(authUserId));
    // A link for another user, or of another kind, is never exchanged: it stays unused and dies with its hour.
    return link.userId === authUserId && link.verificationType === "magiclink" ? link.hashedToken : null;
  } catch (thrown) {
    return failure(thrown);
  }
}

/** verifyOtp in a client with no cookies: the session, or null when Auth refuses a token it just made or the session is of another user. */
async function exchange(hashedToken: string, authUserId: string): Promise<ExchangedSession | null> {
  try {
    const session = await exchangeMagicLink(hashedToken);
    return session.userId === authUserId ? session : null;
  } catch (thrown) {
    // A token Auth refuses right after making it says nothing about the person: the generic error, not an outage.
    if (thrown instanceof AuthAdminError && thrown.kind === "invalid") return null;
    return failure(thrown);
  }
}

/**
 * The session of a student, without cookies yet: generateLink (checking that the user is authUserId and the type is magiclink),
 * verifyOtp in a client with no cookies, and internal_bind_student_session with the version. Returns the tokens, or null if
 * anything does not match (the caller answers the generic error). 429 from Auth is not a null: it is an AuthBusyError.
 */
export async function openStudentSession(authUserId: string, version: number, hooks?: OpenSessionHooks): Promise<SessionTokens | null> {
  const hashedToken = await linkFor(authUserId);
  if (hashedToken === null) return null;
  const session = await exchange(hashedToken, authUserId);
  if (session === null) return null;

  await hooks?.beforeBind?.();
  // The last step before the cookies: under the lock of the student, the version that was checked is still the current one.
  // If it is not (a card was issued), this deletes the session and registers nothing.
  const bound = await accounts.bindStudentSession(adminDb(), { authUserId, sessionId: session.sessionId, version });
  return bound ? { accessToken: session.accessToken, refreshToken: session.refreshToken } : null;
}

/** internal_find_institution; null when there is no school with that code. */
export async function findInstitution(code: string): Promise<FoundInstitution | null> {
  return accounts.findInstitution(adminDb(), code.trim().toLowerCase());
}

/** internal_resolve_access_card; null for a card that is not active. Never the name of the student. */
export async function resolveAccessCard(tokenHash: string): Promise<SchoolAndUser | null> {
  return accounts.resolveAccessCard(adminDb(), tokenHash);
}
