import "server-only";
import type { Actor, StaffActor, StudentActor } from "@/lib/domain/accounts/entities";
import { unavailable } from "../unavailable";

// Who makes the request (T2.1). It reads the Supabase session, never the cookie of the demo, and asks the database
// for the institutions and roles (list_my_institutions): the services do not decide permissions, the RPCs do.
// With Cache Components it caches per request with 'use cache: private' (node_modules/next/dist/docs).

/** null without a session, a staff actor with its institutions and roles, or a student with its institution. */
export async function getActor(): Promise<Actor | null> {
  return unavailable();
}

/** The staff actor, or FORBIDDEN: no session, or a student session. */
export async function requireStaff(): Promise<StaffActor> {
  return unavailable();
}

/** The staff actor if it is an admin of that institution; FORBIDDEN otherwise (also for an admin of another one). */
export async function requireAdmin(institutionId: string): Promise<StaffActor> {
  return unavailable(institutionId);
}

export async function requireStudent(): Promise<StudentActor> {
  return unavailable();
}
