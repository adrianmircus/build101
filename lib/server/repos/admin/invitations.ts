import "server-only";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import { callRpc, type RpcDb } from "../rpc";

// The invitation RPCs that only service_role runs (T2.3): the page of an invitation for somebody with no session, the last
// step of the signup with no account, and the administration command. The token hash is the `\x<hex>` of sha256(token).

export async function getInvitation(admin: RpcDb, tokenHash: string) {
  return callRpc(admin, "internal_get_invitation", { p_token_hash: tokenHash });
}

export type InvitationSignup = { tokenHash: string; userId: string; displayName: string };

/** The app_user, the membership and the acceptance in one transaction, under the lock of the invitation. */
export async function finishSignup(admin: RpcDb, input: InvitationSignup) {
  return callRpc(admin, "internal_finish_invitation_signup", {
    p_token_hash: input.tokenHash,
    p_user_id: input.userId,
    p_display_name: input.displayName,
  });
}

export type OperatorInvitation = { institutionId: string; email: string; role: InvitedRole; tokenHash: string };

/** For the administration command (T2.2): no actor, so `invited_by` stays NULL. */
export async function createAsOperator(admin: RpcDb, input: OperatorInvitation) {
  return callRpc(admin, "internal_create_invitation", {
    p_institution_id: input.institutionId,
    p_email: input.email,
    p_role: input.role,
    p_token_hash: input.tokenHash,
  });
}
