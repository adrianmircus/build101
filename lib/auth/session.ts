import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo/mode";
import { SESSION_COOKIE, SESSION_MAX_AGE, sign, verify, type Session } from "./signing";

export async function createSession(session: Session) {
  (await cookies()).set(SESSION_COOKIE, sign(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function readSession(): Promise<Session | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  // verify() compares the expiry with the current time: that only runs at request time, never while prerendering.
  await connection();
  return verify(value);
}

export async function deleteSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

// The UI's demo flag. Not httpOnly: the client reads it to pick the demo's data and show the tour.
export async function setDemoFlag(on: boolean) {
  const store = await cookies();
  if (!on) {
    store.delete(DEMO_COOKIE);
    return;
  }
  store.set(DEMO_COOKIE, "1", {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}
