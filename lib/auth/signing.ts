// Signing and verification of the session cookie. No "server-only" because proxy.ts uses it too.
import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "teacher" | "student";

// Only identifies the person. The student's profile never travels in the cookie.
export type Session = { id: string; role: Role };

export const SESSION_COOKIE = "session";

// Simulated login for the demo. In production SESSION_SECRET must be set.
const SECRET = process.env.SESSION_SECRET || "local-development-only";

function hmac(data: string) {
  return createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function sign(session: Session): string {
  const data = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${data}.${hmac(data)}`;
}

export function verify(value: string | undefined): Session | null {
  if (!value) return null;
  const [data, signature] = value.split(".");
  if (!data || !signature) return null;
  const expected = Buffer.from(hmac(data));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString()) as Session;
  } catch {
    return null;
  }
}
