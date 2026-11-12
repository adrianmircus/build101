import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { localStack } from "./env";
import { world } from "./world";

// People of the school of the run, made through the same RPCs the platform uses with the secret key of the local Supabase.
// Each test that changes a password or burns the attempt counters makes its own person: tests never share an account.

const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export type StaffAccount = { id: string; email: string; password: string };

export function adminClient(): SupabaseClient {
  const stack = localStack();
  return createClient(stack.apiUrl, stack.secretKey, OPTIONS);
}

export function publishableClient(): SupabaseClient {
  const stack = localStack();
  return createClient(stack.apiUrl, stack.publishableKey, OPTIONS);
}

/** One RPC of schema api. Only its name goes into the error: never the arguments or what the database said. */
export async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.schema("api").rpc(name, args);
  if (error) throw new Error(`Falló ${name} al preparar la prueba (${error.code ?? "sin código"}).`);
  return data;
}

export function idOf(value: unknown): string {
  const id = typeof value === "object" && value !== null ? Reflect.get(value, "id") : value;
  if (typeof id !== "string") throw new Error("La respuesta de la preparación no trae un id.");
  return id;
}

/** A person with a password and a membership. Long enough for the minimum of the local Auth (10 characters). */
export async function createStaffAccount(institutionId: string, role: "admin" | "teacher", displayName: string): Promise<StaffAccount> {
  const admin = adminClient();
  const email = `${role}.${randomUUID().replaceAll("-", "").slice(0, 10)}@tiza-e2e.example`;
  const password = `${randomUUID().slice(0, 12)}-Tiza27`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`No se pudo crear la cuenta de prueba (${error.code ?? "sin código"}).`);
  await rpc(admin, "internal_upsert_app_user", { p_user_id: data.user.id, p_display_name: displayName });
  await rpc(admin, "internal_add_membership", { p_institution_id: institutionId, p_user_id: data.user.id, p_role: role });
  return { id: data.user.id, email, password };
}

/** A teacher of the school of the run, for a test of its own. */
export function newTeacher(displayName = "Profe de prueba"): Promise<StaffAccount> {
  return createStaffAccount(world().institution.id, "teacher", displayName);
}
