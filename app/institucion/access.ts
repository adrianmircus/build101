import "server-only";
import { connection } from "next/server";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import type { StaffActor } from "@/lib/domain/accounts/entities";
import { Id } from "@/lib/domain/common";
import { AppError } from "@/lib/errors";
import { getActor, requireAdmin } from "@/lib/server/auth/actor";

// Who may see a page of the admin area. The pages call these first. The database checks again in every RPC: this is only
// so that someone without the right role sees a clear page and not an error.

/** The signed-in staff, or the redirect to where they belong: no session goes to the login, a student to their home. */
export async function staffOrRedirect(): Promise<StaffActor> {
  // Reads the session of this request: dynamic, never prerendered (Supabase uses Date.now(), which a prerender forbids).
  await connection();
  const actor = await getActor();
  if (!actor) redirect("/ingresar/profesor");
  if (actor.kind === "student") redirect("/estudiante");
  return actor;
}

/** The admin of this school, or null when the person is signed in but is not one (the page says so). */
export async function adminOrNull(institutionId: string): Promise<StaffActor | null> {
  if (!Id.safeParse(institutionId).success) notFound();
  await staffOrRedirect();
  try {
    return await requireAdmin(institutionId);
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") return null;
    throw error;
  }
}

export type Loaded<T> = { ok: true; data: T } | { ok: false };

/** Reads something with a service; a failure (not ready, down) is a value the page turns into a neutral message. */
export async function load<T>(read: () => Promise<T>): Promise<Loaded<T>> {
  // Reads the session of this request: dynamic, never prerendered (Supabase uses Date.now(), which a prerender forbids).
  await connection();
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false };
  }
}
