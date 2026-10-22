// Signing and verification of the session cookie. No "server-only" because proxy.ts uses it too.
import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "teacher" | "student";

// Only identifies the person. The student's profile never travels in the cookie.
// demo: entered from "Probar la demo" on the landing; it can't call the AI (see proxy.ts).
export type Session = { id: string; role: Role; demo?: boolean };

export const SESSION_COOKIE = "session";

// How long a session lasts, in seconds. The cookie expires then, and the signed value says so too:
// a copied cookie stops working even if the browser keeps it.
export const SESSION_MAX_AGE = 60 * 60 * 8;

// Simulated login for the demo. In production SESSION_SECRET must be set: without it anyone could sign
// a session with the public fallback, so it fails on the first login or request instead of at build time.
function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("Falta SESSION_SECRET: configurala en las variables de entorno.");
  return "local-development-only";
}

function hmac(data: string) {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function sign(session: Session): string {
  const payload = {
    id: session.id,
    role: session.role,
    ...(session.demo && { demo: true }),
    exp: Date.now() + SESSION_MAX_AGE * 1000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
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
    const { id, role, demo, exp } = JSON.parse(Buffer.from(data, "base64url").toString());
    // Without an expiry (cookies from before it existed) or past it: log in again.
    if (typeof exp !== "number" || exp <= Date.now()) return null;
    return (demo === true ? { id, role, demo } : { id, role }) as Session;
  } catch {
    return null;
  }
}
