import "server-only";
import { callRpc, type RpcDb } from "../rpc";

// The counters of attempts (app.rate_limits) through the internal RPCs of T2.7. The keys are already hashed:
// this file never sees an IP, an email or a username.

export type RateLimitHit = { keys: string[]; limits: number[]; windowSeconds: number };

/** Counts one attempt in the current window of each key (up to 4), in one statement. `retryAt` is the end of the window. */
export async function hitRateLimit(admin: RpcDb, hit: RateLimitHit): Promise<{ allowed: boolean; retryAt: string }> {
  return callRpc(admin, "internal_rate_limit_hit", { p_keys: hit.keys, p_limits: hit.limits, p_window_seconds: hit.windowSeconds });
}

/** Deletes the current window of those keys (a success starts the subject from zero). */
export async function clearRateLimit(admin: RpcDb, keys: string[]): Promise<{ cleared: number }> {
  return callRpc(admin, "internal_rate_limit_clear", { p_keys: keys });
}
