import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { readPublicDbEnv } from "./env";
import type { Database } from "./types";

export type SessionClient = SupabaseClient<Database>;

/**
 * Client that acts as the logged-in user: it reads the Supabase session from the request cookies, so
 * the database sees `auth.uid()` and applies the permissions of that user. Only `lib/server/repos/*`
 * imports it (ESLint enforces it).
 *
 * Call it per request, never at module level: it needs the cookies of the current request. With
 * Cache Components, call it from a request-time scope (see authentication-with-cache-components.md).
 */
export async function createSessionClient(): Promise<SessionClient> {
  const { url, publishableKey } = readPublicDbEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot write cookies. The session refresh then happens in proxy.ts
          // (phase 2), which can; ignoring the error here is what @supabase/ssr documents.
        }
      },
    },
  });
}
