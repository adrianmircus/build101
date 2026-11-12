import "server-only";
import { z } from "zod";
import { createSessionClient } from "../db/client";
import { unavailable } from "../unavailable";

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
