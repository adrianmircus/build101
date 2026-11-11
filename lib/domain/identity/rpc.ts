import { z } from "zod";
import { Created, DisplayName, Id, type RpcSpec, Timestamp } from "../common";
import { InstitutionCode, InstitutionKind, MemberRole } from "./entities";

// RPCs of identity (supabase/migrations/20261111131000_rpc_identity_groups.sql), owner T1.2a.
// args are keyed exactly like the SQL parameters so a repo passes them straight to supabase.rpc;
// lib/server/db/rpc-contract.ts checks at compile time that they match the generated types.

const MyInstitution = z
  .object({
    id: Id,
    name: z.string(),
    kind: InstitutionKind,
    roles: z.array(MemberRole).min(1),
  })
  .strict();
export type MyInstitution = z.infer<typeof MyInstitution>;

export const IDENTITY_RPCS = {
  /** service_role: the admin command (T2.2), sandboxes (T4.9) and the test factories. */
  internal_create_institution: {
    args: z
      .object({
        p_name: z.string().trim().min(1).max(200),
        p_code: InstitutionCode,
        p_kind: InstitutionKind,
        p_expires_at: Timestamp.optional(),
        p_owner_user_id: Id.optional(),
      })
      .strict(),
    result: Created,
  },
  internal_upsert_app_user: {
    args: z.object({ p_user_id: Id, p_display_name: DisplayName.optional() }).strict(),
    result: Created,
  },
  internal_add_membership: {
    args: z.object({ p_institution_id: Id, p_user_id: Id, p_role: MemberRole }).strict(),
    result: Created,
  },
  internal_revoke_membership: {
    args: z.object({ p_membership_id: Id }).strict(),
    result: Created,
  },
  list_my_institutions: {
    args: z.object({}).strict(),
    result: z.object({ items: z.array(MyInstitution) }).strict(),
  },
} satisfies Record<string, RpcSpec>;
