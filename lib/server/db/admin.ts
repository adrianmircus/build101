import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readAdminDbEnv } from "./env";
import type { Database } from "./types";

// Every RPC lives in schema api, the only one PostgREST exposes (supabase/config.toml).
export type AdminClient = SupabaseClient<Database, "api">;

/**
 * Client with the secret key: it bypasses RLS and acts as `service_role`. It has no user and no
 * session, so nothing is persisted or refreshed. Only `lib/server/repos/admin/` and the tests
 * import it (ESLint enforces it). Every call through it must come from an intention that an
 * authorized RPC stored earlier: never act on an id the browser sends.
 */
export function createAdminClient(): AdminClient {
  const { url, secretKey } = readAdminDbEnv();
  return createClient<Database, "api">(url, secretKey, {
    db: { schema: "api" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
