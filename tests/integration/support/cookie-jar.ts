import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { readPublicDbEnv } from "@/lib/server/db/env";

// The cookies of the "browser" of a test: what the proxy and Supabase leave in the request. The services read them through
// next/headers, so each test file mocks that module with `nextHeadersMock()` and puts there the session it wants to play:
//
//   vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());

export const browser = { jar: new Map<string, string>() };

export function nextHeadersMock() {
  return {
    cookies: async () => ({
      getAll: () => [...browser.jar].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string) => {
        if (value === "") browser.jar.delete(name);
        else browser.jar.set(name, value);
      },
    }),
    headers: async () => new Headers(),
  };
}

export type Credentials = { email: string; password: string };

/** Signs in like the login does, leaving the session in the jar; returns the id of the session in Auth. */
export async function openSession(credentials: Credentials): Promise<string> {
  const { url, publishableKey } = readPublicDbEnv();
  const jar = new Map<string, string>();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => toSet.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error || !data.session) throw new Error("No se pudo abrir la sesión de prueba.");
  browser.jar = jar;
  const payload = Buffer.from(data.session.access_token.split(".")[1] ?? "", "base64url").toString("utf8");
  return z.object({ session_id: z.string() }).parse(JSON.parse(payload)).session_id;
}

/** A visitor with no session. */
export function signOutOfTheJar(): void {
  browser.jar = new Map();
}
