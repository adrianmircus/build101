import "server-only";
import { unavailable } from "../unavailable";

// Every call to Supabase Auth made with the session of the user (the publishable key and the cookies), the only way
// layers.mjs lets db/client.ts be used. T2.1 writes getClaims; T2.3 writes the rest. None logs an email, a password or a
// token, and none returns the raw Auth error: a wrong credential is `null`, never a message.

export type SessionClaims = { userId: string; sessionId: string | null; email: string | null };
export type SignOutScope = "local" | "others" | "global";

/** The verified claims of the current session (getClaims), or null without a session. */
export async function getClaims(): Promise<SessionClaims | null> {
  return unavailable();
}

/** signInWithPassword; null when Auth refuses the pair. Leaves the session cookies. */
export async function signInWithPassword(email: string, password: string, options?: { signal?: AbortSignal }): Promise<SessionClaims | null> {
  return unavailable(email, password, options);
}

export async function signOut(scope: SignOutScope): Promise<void> {
  return unavailable(scope);
}

/** verifyOtp({ type: "recovery", token_hash }); false when the link expired or was already used. Leaves a session. */
export async function verifyRecoveryOtp(tokenHash: string): Promise<boolean> {
  return unavailable(tokenHash);
}

/** updateUser({ password }) for the current session. */
export async function updatePassword(password: string): Promise<void> {
  return unavailable(password);
}

/** resetPasswordForEmail: Auth sends the mail (template supabase/templates/recovery.html). */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  return unavailable(email, redirectTo);
}
