import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// The scrypt hash of the password of a student (T2.5b): crypto.scrypt of Node, no dependency. Fixed parameters: N = 2^15, r = 8,
// p = 1, a key of 32 bytes, a salt of 16 bytes and maxmem of 64 MiB (without maxmem Node 24 rejects those parameters). The format
// is `scrypt$15$8$1$<salt>$<hash>` with salt and hash in base64. verifyPassword checks the format, the parameters and the decoded
// lengths strictly and compares with timingSafeEqual. The hash is computed in the server and never sent anywhere else.

const LOG_N = 15;
const R = 8;
const P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

// 16 bytes in base64 are 22 characters and `==`; 32 bytes are 43 characters and `=`. Nothing else is a hash of ours.
const FORMAT = /^scrypt\$15\$8\$1\$([A-Za-z0-9+/]{22}==)\$([A-Za-z0-9+/]{43}=)$/;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: 2 ** LOG_N, r: R, p: P, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** The hash of a password, with a new salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `scrypt$${LOG_N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** The salt and the key of a hash that is exactly in our format, or null. Base64 that does not encode back to the same text is refused. */
function parse(hash: string): { salt: Buffer; key: Buffer } | null {
  const [, saltText, keyText] = FORMAT.exec(hash) ?? [];
  if (saltText === undefined || keyText === undefined) return null;
  const salt = Buffer.from(saltText, "base64");
  const key = Buffer.from(keyText, "base64");
  if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null;
  if (salt.toString("base64") !== saltText || key.toString("base64") !== keyText) return null;
  return { salt, key };
}

/** True when the password matches that hash; false for any hash that is not in exactly that format (never throws on a bad hash). */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parsed = parse(hash);
  if (parsed === null) return false;
  const candidate = await derive(password, parsed.salt);
  return timingSafeEqual(candidate, parsed.key);
}

/**
 * A fixed hash with exactly the same parameters, nobody knows the password of: an unknown user is checked against it so the work is
 * the same as for a wrong password. Matching it never opens a session: the login also needs the fields of the RPC, which are null
 * for an unknown user, so the result is always "no match". The salt and the key are 16 and 32 random bytes, thrown away.
 */
export const DECOY_HASH = `scrypt$${LOG_N}$${R}$${P}$9du3i5zD3wQVUZjyr1sIBw==$dhy/F9s0JKUf+HDY4XCVWYi6Eg6JI/YQNqaA3nLdAa4=`;
