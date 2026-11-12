import "server-only";
import type { RpcResult } from "@/lib/domain/rpc";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import { unavailable } from "../../unavailable";

// The signup by invitation with the admin client (T2.3): the token is the credential. Never changes the password of an
// account that already exists. Uses repos/admin/invitations.ts and repos/admin/auth-users.ts.

export type InvitationRecord = RpcResult<"internal_get_invitation">;
export type InvitedAccount = { tokenHash: string; invitationId: string; email: string; password: string; displayName: string };

/** internal_get_invitation: the invitation of a token hash (NOT_FOUND if there is none), with `hasAccount`. */
export async function readInvitationByToken(tokenHash: string): Promise<InvitationRecord> {
  return unavailable(tokenHash);
}

/** auth.admin.createUser with a random id, email_confirm, app_metadata.invitation_id and the display name; returns the user id. */
export async function createInvitedAccount(input: InvitedAccount): Promise<{ userId: string }> {
  return unavailable(input);
}

/** internal_finish_invitation_signup: app_user, membership and acceptance in one transaction. */
export async function finishInvitationSignup(input: { tokenHash: string; userId: string; displayName: string }): Promise<{ institutionId: string; role: InvitedRole }> {
  return unavailable(input);
}

/** internal_create_invitation for the admin command (T2.2): no actor, invited_by stays NULL. */
export async function createInvitationAsOperator(input: { institutionId: string; email: string; role: InvitedRole; tokenHash: string }): Promise<{ id: string; expiresAt: string; revision: number }> {
  return unavailable(input);
}
