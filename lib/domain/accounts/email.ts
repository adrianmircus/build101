// The synthetic email of a student: `<random part>@estudiantes.usetiza.app`, with 32 hex characters (16 random bytes).
// It is not derived from any id the teachers see, and every new card changes it. The current one lives only in
// auth.users (internal_resolve_student_login reads it there). It only exists so Supabase Auth has something to sign
// in with. The subdomain receives no mail, and no Auth email is ever sent to it.

export const STUDENT_EMAIL_DOMAIN = "estudiantes.usetiza.app";
const RANDOM_PART = /^[0-9a-f]{32}$/;

/** The decoy account of the student login: an unknown user is checked against it so both paths cost the same. */
export const DECOY_EMAIL = `decoy@${STUDENT_EMAIL_DOMAIN}`;

/** The synthetic email for a random part of 32 hex characters; anything else is a bug and throws. */
export function studentEmail(randomPart: string): string {
  const part = randomPart.toLowerCase();
  if (!RANDOM_PART.test(part)) throw new Error("La parte aleatoria del correo sintético son 32 caracteres hexadecimales.");
  return `${part}@${STUDENT_EMAIL_DOMAIN}`;
}

/** The random part of a synthetic email, or null when it is any other address (the decoy included). */
export function randomPartFromEmail(email: string): string | null {
  const [local, domain, ...rest] = email.trim().toLowerCase().split("@");
  if (domain !== STUDENT_EMAIL_DOMAIN || rest.length > 0 || local === undefined) return null;
  return RANDOM_PART.test(local) ? local : null;
}

/** True for anything at the synthetic domain, whatever its local part: such an address never gets mail. */
export function isSyntheticEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${STUDENT_EMAIL_DOMAIN}`);
}

/** The form an email takes everywhere it is stored or compared: no spaces at the edges, lower case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
