import "server-only";
import { callRpc, type RpcDb } from "../rpc";

/** Deletes every session of a user in auth.sessions: from then on no RPC accepts the access tokens that were open. */
export async function revokeSessions(admin: RpcDb, userId: string): Promise<{ revoked: number }> {
  return callRpc(admin, "internal_revoke_user_sessions", { p_user_id: userId });
}
