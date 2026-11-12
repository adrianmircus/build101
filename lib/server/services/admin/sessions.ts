import "server-only";
import { adminDb } from "../../repos/admin/db";
import { revokeSessions } from "../../repos/admin/sessions";

// Closing the sessions of a user (T2.7), for a new card: after this no RPC accepts the access token that was open.

/** internal_revoke_user_sessions with an id that an RPC already authorized. */
export async function revokeUserSessions(userId: string): Promise<{ revoked: number }> {
  return revokeSessions(adminDb(), userId);
}
