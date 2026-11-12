import "server-only";
import { isSyntheticEmail, normalizeEmail } from "@/lib/domain/accounts/email";
import type { NextStep, RecoveryVerified, ResetRequested } from "@/lib/domain/accounts/results";
import { AppError } from "@/lib/errors";
import { log } from "../log";
import * as session from "../repos/auth-session";
import { clearSubject, guardAttempt } from "./rate-limit";

// Sign in, recover the password and sign out of the staff (T2.3). The email and the password never reach a log.
// Every sign in that does not get in takes the same time (up to 800 ms from the start) and gives the same generic error.

export type SignInStaff = { email: string; password: string; ip: string };
export type RequestPasswordReset = { email: string; ip: string; origin: string };

const MISMATCH = "El correo o la contraseña no coinciden. Revisalos y probá de nuevo.";
const LINK_GONE = "El enlace venció o ya se usó. Pedí uno nuevo desde «Olvidé mi contraseña».";
const SESSION_ENDED = "Tu sesión terminó. Volvé a entrar.";
const ACCOUNT_CHANGED = "Cambiaste de cuenta en otra pestaña. Abrí el enlace de nuevo.";
const STAFF_HOME = "/grupos";
const MIN_ANSWER_MS = 800;
/** Auth that does not answer in this time is an outage, not a wrong password. */
const AUTH_DEADLINE_MS = 8_000;

async function waitUntil(startedAt: number, afterMs: number): Promise<void> {
  const left = startedAt + afterMs - Date.now();
  if (left > 0) await new Promise<void>((resolve) => setTimeout(resolve, left));
}

/**
 * Whatever makes this fail (a wrong password, an email with no account, a block of the limit) answers no sooner than 800 ms after
 * it started: the time says nothing about which one it was. A success answers when it is done.
 */
async function slowWhenItFails<T>(startedAt: number, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    await waitUntil(startedAt, MIN_ANSWER_MS);
    throw error;
  }
}

/** guardAttempt, then Auth signInWithPassword. A wrong email or password gives the same generic error. */
export async function signInStaff(input: SignInStaff): Promise<NextStep> {
  const startedAt = Date.now();
  const email = normalizeEmail(input.email);
  return slowWhenItFails(startedAt, async () => {
    await guardAttempt("staff", input.ip, email);
    const claims = await session.signInWithPassword(email, input.password, { signal: AbortSignal.timeout(AUTH_DEADLINE_MS) });
    if (claims === null) throw new AppError("FORBIDDEN", MISMATCH);
    // A success starts the person from zero. Failing to clear never blocks a sign in that already worked.
    await clearSubject("staff", email, input.ip).catch(() => log.warn("rate_limit.clear_failed", { limitKind: "staff" }));
    return { next: STAFF_HOME };
  });
}

/** Always answers `sent`. A synthetic email (of a student) is rejected without calling Auth. */
export async function requestPasswordReset(input: RequestPasswordReset): Promise<ResetRequested> {
  const startedAt = Date.now();
  const email = normalizeEmail(input.email);
  return slowWhenItFails(startedAt, async () => {
    await guardAttempt("reset", input.ip, email);
    if (!isSyntheticEmail(email)) await session.requestPasswordReset(email, `${input.origin}/ingresar/profesor/nueva`);
    // With or without an account the answer takes the same time.
    await waitUntil(startedAt, MIN_ANSWER_MS);
    return { sent: true };
  });
}

/** verifyOtp({ type: "recovery", token_hash }) with the hash of the link fragment: leaves a session, or says the link expired. */
export async function verifyRecovery(input: { tokenHash: string }): Promise<RecoveryVerified> {
  const userId = await session.verifyRecoveryOtp(input.tokenHash);
  if (userId === null) throw new AppError("FORBIDDEN", LINK_GONE);
  return { verified: true, userId };
}

/**
 * updateUser({ password }) and signOut({ scope: "others" }); then /grupos. `userId` is the account that verifyRecovery verified: if the
 * session of this browser is another one now (somebody signed out and in as another person in another tab), nothing changes.
 */
export async function setNewPassword(input: { password: string; userId: string }): Promise<NextStep> {
  const claims = await session.getClaims();
  if (claims === null) throw new AppError("FORBIDDEN", SESSION_ENDED);
  if (claims.userId !== input.userId) throw new AppError("CONFLICT", ACCOUNT_CHANGED);
  await session.updatePassword(input.password);
  await session.signOut("others");
  return { next: STAFF_HOME };
}

/** signOut({ scope: "local" }) and where to go: the login of the type of session that was open. */
export async function signOut(): Promise<NextStep> {
  const claims = await session.getClaims();
  const student = claims?.email != null && isSyntheticEmail(claims.email);
  await session.signOut("local");
  return { next: student ? "/ingresar/estudiante" : "/ingresar/profesor" };
}
