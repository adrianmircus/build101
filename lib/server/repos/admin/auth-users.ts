import "server-only";
import { unavailable } from "../../unavailable";

// The admin API of Supabase Auth (T2.3; T2.5b uses it, does not change it). Only with ids and emails that an RPC
// authorized first. Never logs an email, a password or an id of a person.

export type AuthUser = { id: string; email: string; appMetadata: Record<string, string> };
export type NewAuthUser = { id: string; email: string; password?: string; appMetadata: Record<string, string> };

/** auth.admin.createUser with the given id and email_confirm: true. */
export async function createAuthUser(input: NewAuthUser): Promise<AuthUser> {
  return unavailable(input);
}

/** auth.admin.getUserById; null when it does not exist. */
export async function getAuthUser(id: string): Promise<AuthUser | null> {
  return unavailable(id);
}

export async function setAuthPassword(id: string, password: string): Promise<void> {
  return unavailable(id, password);
}

export async function deleteAuthUser(id: string): Promise<void> {
  return unavailable(id);
}
