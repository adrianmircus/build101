import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, sign, verify, type Session } from "./signing";

export async function createSession(session: Session) {
  (await cookies()).set(SESSION_COOKIE, sign(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function readSession(): Promise<Session | null> {
  return verify((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function deleteSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
