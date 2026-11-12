import { notImplemented } from "./not-implemented";

// The initial password of a student: three short words and a two-digit number without 0 or 1 ("sol-nube-tigre-47",
// about 33 bits). Generated with crypto.randomInt, never Math.random. The plain password is never stored: only its scrypt
// hash (lib/server/auth/password-hash.ts, table student_credentials) and the printed sheet have it. Implemented by T2.5b.

/** A new initial password in the format above. */
export function generateInitialPassword(): string {
  return notImplemented();
}
