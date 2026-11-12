import "server-only";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import { callRpc, type RpcDb } from "./rpc";

// Invitations as the logged-in person sees them (T2.3). The database decides who may do what: only an admin of the
// institution invites, resends, revokes and lists; accepting belongs to whoever has the invited email. The token hash is the
// `\x<hex>` of sha256(token), computed by the server (lib/server/auth/tokens.ts).

export type NewInvitation = { institutionId: string; email: string; role: InvitedRole; tokenHash: string; opKey: string };

/** The same `opKey` with the same email and role gives the same invitation back, with `replayed: true`. */
export async function createInvitation(db: RpcDb, input: NewInvitation) {
  return callRpc(db, "create_invitation", {
    p_institution_id: input.institutionId,
    p_email: input.email,
    p_role: input.role,
    p_token_hash: input.tokenHash,
    p_op_key: input.opKey,
  });
}

/** A pending or expired invitation gets a new hash, seven more days and `revision + 1`; `revision` is the one the caller read. */
export async function resendInvitation(db: RpcDb, input: { invitationId: string; revision: number; tokenHash: string }) {
  return callRpc(db, "resend_invitation", { p_invitation_id: input.invitationId, p_revision: input.revision, p_token_hash: input.tokenHash });
}

export async function revokeInvitation(db: RpcDb, invitationId: string, revision: number) {
  return callRpc(db, "revoke_invitation", { p_invitation_id: invitationId, p_revision: revision });
}

/** The email of the token of that revision went out; a rotated token is CONFLICT. */
export async function markInvitationSent(db: RpcDb, invitationId: string, revision: number) {
  return callRpc(db, "mark_invitation_sent", { p_invitation_id: invitationId, p_revision: revision });
}

export async function listInvitations(db: RpcDb, institutionId: string) {
  const { items } = await callRpc(db, "list_invitations", { p_institution_id: institutionId });
  return items;
}

/** With the session of whoever accepts: the database reads their current, confirmed email. */
export async function acceptInvitation(db: RpcDb, tokenHash: string) {
  return callRpc(db, "accept_invitation", { p_token_hash: tokenHash });
}
