import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/server/db/admin";
import { readAdminDbEnv } from "@/lib/server/db/env";
import type { RpcDb } from "../rpc";

// The only door to the admin clients (service_role) for the services of lib/server/services/admin/. A service asks for the
// client here and hands it to the repos, which receive an `RpcDb`; a repo never creates one.

/** Every request to Auth is dead after this long: the lease of an account needs a call that is resolved or dead by then. */
export const AUTH_FETCH_TIMEOUT_MS = 5_000;

/** The admin client for the internal_* RPCs. It acts as service_role: use it only with what an authorized RPC stored. */
export function adminDb(): RpcDb {
  return createAdminClient();
}

/**
 * `auth.admin` of an admin client whose every request is cut after 5 seconds (`global.fetch`). A request that already
 * carries its own signal keeps it too: whichever fires first wins. `timeoutMs` is only for tests.
 */
export function authAdmin(timeoutMs: number = AUTH_FETCH_TIMEOUT_MS) {
  const { url, secretKey } = readAdminDbEnv();
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        const timeout = AbortSignal.timeout(timeoutMs);
        return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
      },
    },
  });
  return client.auth.admin;
}
