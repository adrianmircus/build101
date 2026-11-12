import "server-only";
import type { FoundInstitution, SchoolAndUser } from "@/lib/domain/accounts/results";
import type { RpcResult } from "@/lib/domain/rpc";
import type { SessionTokens } from "../../repos/auth-session";
import { unavailable } from "../../unavailable";

// What the login of the students needs before anyone has a session (T2.5b), with the admin client. The password hash comes
// out of the database only here, and only to be checked in the server: it is never returned to a page or an action.

export type StudentLoginData = RpcResult<"internal_get_student_login">;

/** internal_get_student_login: authUserId and passwordHash only for an active, not archived student with a credential. */
export async function studentLogin(code: string, username: string): Promise<StudentLoginData> {
  return unavailable(code, username);
}

/**
 * The session of a student, without cookies yet: generateLink (checking that the user is authUserId and the type is magiclink),
 * verifyOtp in a client with no cookies, and internal_bind_student_session with the version. Returns the tokens, or null if
 * anything does not match (the caller answers the generic error). 429 from Auth is not a null: it is its own error.
 */
export async function openStudentSession(authUserId: string, version: number): Promise<SessionTokens | null> {
  return unavailable(authUserId, version);
}

/** internal_find_institution; null when there is no school with that code. */
export async function findInstitution(code: string): Promise<FoundInstitution | null> {
  return unavailable(code);
}

/** internal_resolve_access_card; null for a card that is not active. Never the name of the student. */
export async function resolveAccessCard(tokenHash: string): Promise<SchoolAndUser | null> {
  return unavailable(tokenHash);
}
