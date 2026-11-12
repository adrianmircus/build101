import { randomUUID } from "node:crypto";
import type { MemberRole } from "@/lib/domain/identity/entities";
import type { AdminClient } from "@/lib/server/db/admin";
import { callRpc } from "@/lib/server/repos/rpc";

// A user of Auth, linked to the platform only through the internal RPCs (never with SQL).

export type TestUser = { id: string; email: string; password: string };

export type UserOptions = { institutionId: string; role: MemberRole; displayName?: string };

export async function createUser(admin: AdminClient, options: UserOptions): Promise<TestUser> {
  const email = `${randomUUID()}@tiza-test.example`;
  // Long and random: it only lives for the test, but the local Auth enforces its password rules.
  const password = `${randomUUID()}${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`No se pudo crear el usuario de prueba (${error.code ?? "sin código"}).`);

  const id = data.user.id;
  await callRpc(admin, "internal_upsert_app_user", {
    p_user_id: id,
    p_display_name: options.displayName ?? "Usuario de prueba",
  });
  await callRpc(admin, "internal_add_membership", {
    p_institution_id: options.institutionId,
    p_user_id: id,
    p_role: options.role,
  });
  return { id, email, password };
}
