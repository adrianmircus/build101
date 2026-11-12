import "server-only";
import { unavailable } from "../unavailable";

// Limit of attempts in Postgres (T2.7). Every attempt counts BEFORE Auth is tried, in one atomic statement
// (internal_rate_limit_hit); a success clears the counters of its subject. Windows of 15 minutes (1 hour for resets).
// Keys are `<bucket>:<hex of HMAC-SHA256(RATE_LIMIT_SECRET, value)>`: they never store an IP, an email or a username.
//   student  student_pair (ip + subject) 10, student_subject 30. The subject is (school code, username), normalized
//   staff    staff_pair (ip + email) 10, staff_subject (email) 30
//   reset    reset_email 3 per hour, reset_ip 20 per hour
//   token    token_ip 30: opening a card or an invitation, counting every attempt

export type AttemptKind = "student" | "staff" | "reset" | "token";

/**
 * Counts one attempt and, when a counter is over its cap, throws AppError RATE_LIMITED with `retryAt` (the end of the
 * farthest window) without the caller going on to Auth. `subject` is null only for `token`.
 */
export async function guardAttempt(kind: AttemptKind, ip: string, subject: string | null): Promise<void> {
  return unavailable(kind, ip, subject);
}

/** A success: clears the counters of that subject (not the ones of the IP). */
export async function clearSubject(kind: AttemptKind, subject: string): Promise<void> {
  return unavailable(kind, subject);
}
