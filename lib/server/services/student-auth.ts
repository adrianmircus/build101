import "server-only";
import type { FoundInstitution, NextStep, SchoolAndUser } from "@/lib/domain/accounts/results";
import { unavailable } from "../unavailable";

// Sign in of students (T2.5b). The login normalizes what is typed (normalize.ts) and builds the synthetic email from the
// auth user id that internal_resolve_student_login gave. Every sign in that does not get in takes the same time and
// gives the same generic error, whether the school, the user or the password is wrong.

export type SignInStudent = { code: string; username: string; password: string; ip: string };

/** The school by its code, for «Colegio recordado»; NOT_FOUND with a neutral message. Only schools, never sandboxes. */
export async function findInstitution(input: { code: string; ip: string }): Promise<FoundInstitution> {
  return unavailable(input);
}

export async function signInStudent(input: SignInStudent): Promise<NextStep> {
  return unavailable(input);
}

/** The school and username of a current card; every attempt counts against `token_ip`. No name of the student. */
export async function readAccessCard(input: { token: string; ip: string }): Promise<SchoolAndUser> {
  return unavailable(input);
}
