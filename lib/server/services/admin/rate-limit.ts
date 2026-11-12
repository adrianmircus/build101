import "server-only";
import { adminDb } from "../../repos/admin/db";
import { clearRateLimit, hitRateLimit } from "../../repos/admin/rate-limits";

// The counters of attempts with the admin client (T2.7): only through repos/admin/rate-limits.ts, which calls the internal
// RPCs. The public service (services/rate-limit.ts) builds the keys and the caps; this one only moves them.

/** internal_rate_limit_hit: one atomic statement that counts every key; `allowed` is false if any went over its cap. */
export async function hitAttempt(keys: string[], limits: number[], windowSeconds: number): Promise<{ allowed: boolean; retryAt: string }> {
  return hitRateLimit(adminDb(), { keys, limits, windowSeconds });
}

/** internal_rate_limit_clear: deletes the current window of those keys. */
export async function clearAttempts(keys: string[]): Promise<{ cleared: number }> {
  return clearRateLimit(adminDb(), keys);
}
