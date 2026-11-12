import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Tokens of phase 2 (docs/contratos/fase-2.md, «Tokens fuera de la URL que ve el servidor»): 32 bytes of crypto.randomBytes
// in base64url. The database keeps only sha256(token), as a bytea of 32; the server computes it and the RPC receives the
// hash. A token is never logged and never put in an error.

/** A new token: 32 random bytes in base64url (43 characters). It travels once, in the fragment of a link. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256(token) as PostgREST wants a bytea parameter: `\x` and 64 hex digits. */
export function hashToken(token: string): string {
  return `\\x${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * UUID v5 (RFC 9562): the same namespace and name always give the same id. A request carries one `opKey` and every row it makes
 * gets its own, so a repeated request repeats each row's key instead of making a second row.
 */
export function deriveOpKey(namespace: string, name: string): string {
  const id = namespace.toLowerCase();
  if (!UUID_SHAPE.test(id)) throw new Error("deriveOpKey necesita un UUID como espacio de nombres.");
  const digest = createHash("sha1").update(Buffer.from(id.replaceAll("-", ""), "hex")).update(name, "utf8").digest().subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
