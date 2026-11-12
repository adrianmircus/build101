import { Id } from "../common";

// The synthetic email of a student: `<auth_user_id>@estudiantes.usetiza.app`, fixed from the moment the account is created. The
// id is the one of the Auth account (random, chosen before it exists), not the id of the student that the teachers see. The
// Auth account has no password, so knowing the email does not let anyone in. It only exists so Supabase Auth has an address
// to make a magic link for. The subdomain receives no mail, and no Auth email is ever sent to it.

export const STUDENT_EMAIL_DOMAIN = "estudiantes.usetiza.app";

/** The synthetic email of an Auth account, in lower case (Auth lower-cases emails). */
export function studentEmail(authUserId: string): string {
  return `${Id.parse(authUserId).toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`;
}

/** The Auth user id inside a synthetic email, or null when it is any other address. */
export function authUserIdFromEmail(email: string): string | null {
  const [local, domain, ...rest] = email.trim().toLowerCase().split("@");
  if (domain !== STUDENT_EMAIL_DOMAIN || rest.length > 0 || local === undefined) return null;
  const parsed = Id.safeParse(local);
  return parsed.success ? parsed.data : null;
}

/** True for anything at the synthetic domain, whatever its local part: such an address never gets mail. */
export function isSyntheticEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${STUDENT_EMAIL_DOMAIN}`);
}

/** The form an email takes everywhere it is stored or compared: no spaces at the edges, lower case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
