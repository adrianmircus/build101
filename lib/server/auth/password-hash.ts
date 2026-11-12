import "server-only";
import { unavailable } from "../unavailable";

// The scrypt hash of the password of a student (T2.5b): crypto.scrypt of Node, no dependency. Fixed parameters: N = 2^15, r = 8,
// p = 1, a key of 32 bytes, a salt of 16 bytes and maxmem of 64 MiB (without maxmem Node 24 rejects those parameters). The format
// is `scrypt$15$8$1$<salt>$<hash>` with salt and hash in base64. verifyPassword checks the format, the parameters and the decoded
// lengths strictly and compares with timingSafeEqual. The hash is computed in the server and never sent anywhere else.

/** The hash of a password, with a new salt. */
export async function hashPassword(password: string): Promise<string> {
  return unavailable(password);
}

/** True when the password matches that hash; false for any hash that is not in exactly that format (never throws on a bad hash). */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return unavailable(password, hash);
}

/**
 * A fixed hash with exactly the same parameters, nobody knows the password of: an unknown user is checked against it so the work is
 * the same as for a wrong password. Matching it never opens a session: if the RPC gave null fields the result is always "no match".
 * The real salt (16 bytes) and hash (32 bytes) are filled in by the ticket.
 */
export const DECOY_HASH = `scrypt$15$8$1$${"AAAAAAAAAAAAAAAAAAAAAA=="}$${"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}`;
