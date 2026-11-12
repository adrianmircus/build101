import "server-only";
import type { NextStep, RecoveryVerified, ResetRequested } from "@/lib/domain/accounts/results";
import { unavailable } from "../unavailable";

// Sign in, recover the password and sign out of the staff (T2.3). The email and the password never reach a log.
// Every sign in that does not get in takes the same time (up to 800 ms from the start) and gives the same generic error.

export type SignInStaff = { email: string; password: string; ip: string };
export type RequestPasswordReset = { email: string; ip: string; origin: string };

/** guardAttempt, then Auth signInWithPassword. A wrong email or password gives the same generic error. */
export async function signInStaff(input: SignInStaff): Promise<NextStep> {
  return unavailable(input);
}

/** Always answers `sent`. A synthetic email (of a student) is rejected without calling Auth. */
export async function requestPasswordReset(input: RequestPasswordReset): Promise<ResetRequested> {
  return unavailable(input);
}

/** verifyOtp({ type: "recovery", token_hash }) with the hash of the link fragment: leaves a session, or says the link expired. */
export async function verifyRecovery(input: { tokenHash: string }): Promise<RecoveryVerified> {
  return unavailable(input);
}

/** updateUser({ password }) and signOut({ scope: "others" }); then /grupos. */
export async function setNewPassword(input: { password: string }): Promise<NextStep> {
  return unavailable(input);
}

/** signOut({ scope: "local" }) and where to go: the login of the type of session that was open. */
export async function signOut(): Promise<NextStep> {
  return unavailable();
}
