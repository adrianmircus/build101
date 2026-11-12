import "server-only";
import type { FoundInstitution, SchoolAndUser } from "@/lib/domain/accounts/results";
import { unavailable } from "../../unavailable";

// What the login of the students asks the database before anyone has a session (T2.5b), with the admin client.

/** internal_resolve_student_login: `authEmail` only for an active, not archived student of that school; otherwise null. */
export async function resolveStudentLogin(code: string, username: string): Promise<{ institutionFound: boolean; authEmail: string | null }> {
  return unavailable(code, username);
}

/** internal_find_institution; null when there is no school with that code. */
export async function findInstitution(code: string): Promise<FoundInstitution | null> {
  return unavailable(code);
}

/** internal_resolve_access_card; null for a card that is not active. Never the name of the student. */
export async function resolveAccessCard(tokenHash: string): Promise<SchoolAndUser | null> {
  return unavailable(tokenHash);
}
