import "server-only";
import type { InstitutionKind, MemberRole } from "@/lib/domain/identity/entities";
import { callRpc, type RpcDb } from "../rpc";

// The internal_* RPCs of identity. They need the admin client (service_role): only an intention that
// an authorized RPC stored earlier may call them, never an id the browser sends. `admin` is that client.

export type NewInstitution = {
  name: string;
  code: string;
  kind: InstitutionKind;
  expiresAt?: string;
  ownerUserId?: string;
};

/** Idempotent by code: the same code with the same data returns the same institution. */
export async function createInstitution(admin: RpcDb, input: NewInstitution): Promise<{ id: string }> {
  return callRpc(admin, "internal_create_institution", {
    p_name: input.name,
    p_code: input.code,
    p_kind: input.kind,
    p_expires_at: input.expiresAt,
    p_owner_user_id: input.ownerUserId,
  });
}

/** Links an Auth user to the platform. A missing display name never wipes an existing one. */
export async function upsertAppUser(admin: RpcDb, userId: string, displayName?: string): Promise<{ id: string }> {
  return callRpc(admin, "internal_upsert_app_user", { p_user_id: userId, p_display_name: displayName });
}

export type NewMembership = { institutionId: string; userId: string; role: MemberRole };

/** Idempotent: an active membership with the same role is returned, not duplicated. */
export async function addMembership(admin: RpcDb, input: NewMembership): Promise<{ id: string }> {
  return callRpc(admin, "internal_add_membership", {
    p_institution_id: input.institutionId,
    p_user_id: input.userId,
    p_role: input.role,
  });
}

/** The row stays with its revoked_at: who had access when is part of the record. */
export async function revokeMembership(admin: RpcDb, membershipId: string): Promise<{ id: string }> {
  return callRpc(admin, "internal_revoke_membership", { p_membership_id: membershipId });
}
