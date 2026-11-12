import "server-only";
import { cacheLife } from "next/cache";
import type { Actor, StaffActor, StudentActor } from "@/lib/domain/accounts/entities";
import { messageFor } from "@/lib/domain/errors/reasons";
import { AppError } from "@/lib/errors";
import { getClaims } from "../repos/auth-session";
import { sessionDb } from "../repos/db";
import { listMyInstitutions } from "../repos/institutions";

// Who makes the request (T2.1). It reads the Supabase session, never the cookie of the demo, and asks the database
// for the institutions and roles (list_my_institutions): the services do not decide permissions, the RPCs do.
//
// 'use cache: private' (node_modules/next/dist/docs, authentication with Cache Components): it can read cookies(), and in
// production it only reuses the result inside one request (layout, page and action ask once); nothing is kept on the
// server across requests, so a closed session or a revoked role is seen on the next one. The client router may keep the
// output for `stale` seconds: it is the minimum that still lets the route prefetch, because a student's computer is
// shared and a longer time would show the previous person's pages after leaving.

/** null without a session, a staff actor with its institutions and roles, or a student with its institution. */
export async function getActor(): Promise<Actor | null> {
  "use cache: private";
  cacheLife({ stale: 30, revalidate: 30, expire: 60 });
  const claims = await getClaims();
  if (!claims) return null;
  try {
    return actorFrom(claims.userId, await listMyInstitutions(await sessionDb()));
  } catch (error) {
    // A token that is still valid for Auth but whose session was closed (no_session), or a user the platform does not
    // know: the same as no session. Anything else is a bug or an outage and is not hidden.
    if (error instanceof AppError && error.code === "FORBIDDEN") return null;
    throw error;
  }
}

type Memberships = Awaited<ReturnType<typeof listMyInstitutions>>;

/**
 * A student belongs to one institution with only the student role (the database forbids mixing roles). The staff keeps
 * the institutions where it has a staff role. Someone with no membership at all (an invitation not accepted yet, an
 * expired demo) is nobody: it fails closed.
 */
function actorFrom(userId: string, memberships: Memberships): Actor | null {
  const staff = memberships
    .map((item) => ({ ...item, roles: item.roles.filter((role) => role !== "student") }))
    .filter((item) => item.roles.length > 0);
  if (staff.length > 0) return { kind: "staff", userId, institutions: staff };
  const student = memberships[0];
  return student ? { kind: "student", userId, institutionId: student.id } : null;
}

function forbidden(reason: "no_session" | "forbidden"): AppError {
  return new AppError("FORBIDDEN", messageFor("FORBIDDEN", reason));
}

/** The staff actor, or FORBIDDEN: no session, or a student session. */
export async function requireStaff(): Promise<StaffActor> {
  const actor = await getActor();
  if (!actor) throw forbidden("no_session");
  if (actor.kind !== "staff") throw forbidden("forbidden");
  return actor;
}

/** The staff actor if it is an admin of that institution; FORBIDDEN otherwise (also for an admin of another one). */
export async function requireAdmin(institutionId: string): Promise<StaffActor> {
  const actor = await requireStaff();
  const institution = actor.institutions.find((item) => item.id === institutionId);
  if (!institution?.roles.includes("admin")) throw forbidden("forbidden");
  return actor;
}

export async function requireStudent(): Promise<StudentActor> {
  const actor = await getActor();
  if (!actor) throw forbidden("no_session");
  if (actor.kind !== "student") throw forbidden("forbidden");
  return actor;
}
