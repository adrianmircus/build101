import "server-only";
import { createHmac } from "node:crypto";
import type { RateLimitBucket } from "@/lib/domain/accounts/entities";
import { DEFAULT_MESSAGES } from "@/lib/domain/errors/reasons";
import { AppError } from "@/lib/errors";
import { log } from "../log";
import { clearAttempts, hitAttempt } from "./admin/rate-limit";

// Limit of attempts in Postgres (T2.7). Every attempt counts BEFORE Auth is tried, in one atomic statement
// (internal_rate_limit_hit); a success clears the counters of its subject. Windows of 15 minutes (1 hour for resets).
// Keys are `<bucket>:<hex of HMAC-SHA256(RATE_LIMIT_SECRET, value)>`: they never store an IP, an email or a username.
//   student  student_pair (ip + subject) 10, student_subject 30. The subject is (school code, username), normalized
//   staff    staff_pair (ip + email) 10, staff_subject (email) 30
//   reset    reset_email 3 per hour, reset_ip 20 per hour
//   token    token_ip 30: opening a card or an invitation, counting every attempt
// There is no cap per IP alone for student and staff: a whole school goes out through one IP.

export type AttemptKind = "student" | "staff" | "reset" | "token";

type Counter = { bucket: RateLimitBucket; limit: number; scope: "pair" | "subject" | "ip"; value: (ip: string, subject: string) => string };
type Policy = { windowSeconds: number; counters: Counter[]; needsSubject: boolean };

const QUARTER_HOUR = 15 * 60;
const HOUR = 60 * 60;
const pair = (ip: string, subject: string) => `${ip}|${subject}`;
const bySubject = (_ip: string, subject: string) => subject;
const byIp = (ip: string) => ip;

const POLICIES: Record<AttemptKind, Policy> = {
  student: {
    windowSeconds: QUARTER_HOUR,
    needsSubject: true,
    counters: [
      { bucket: "student_pair", limit: 10, scope: "pair", value: pair },
      { bucket: "student_subject", limit: 30, scope: "subject", value: bySubject },
    ],
  },
  staff: {
    windowSeconds: QUARTER_HOUR,
    needsSubject: true,
    counters: [
      { bucket: "staff_pair", limit: 10, scope: "pair", value: pair },
      { bucket: "staff_subject", limit: 30, scope: "subject", value: bySubject },
    ],
  },
  reset: {
    windowSeconds: HOUR,
    needsSubject: true,
    counters: [
      { bucket: "reset_email", limit: 3, scope: "subject", value: bySubject },
      { bucket: "reset_ip", limit: 20, scope: "ip", value: byIp },
    ],
  },
  token: { windowSeconds: QUARTER_HOUR, needsSubject: false, counters: [{ bucket: "token_ip", limit: 30, scope: "ip", value: byIp }] },
};

const MAX_SUBJECT = 254;
const MAX_IP = 64;

// The secret is read when it is used (a test sets it first) and it is never logged. Without it nothing is counted, so
// nothing is tried: a login that cannot be limited must not run.
function secret(): string {
  const value = process.env.RATE_LIMIT_SECRET ?? "";
  if (value.length < 32) throw new Error("Falta RATE_LIMIT_SECRET (32 caracteres como mínimo). Mirá .env.example.");
  return value;
}

/** The same person written in two ways is one subject: spaces and case do not make a new counter. */
function normalize(subject: string): string {
  return subject.normalize("NFKC").trim().toLowerCase().slice(0, MAX_SUBJECT);
}

function keyOf(bucket: RateLimitBucket, value: string): string {
  return `${bucket}:${createHmac("sha256", secret()).update(value).digest("hex")}`;
}

function subjectOf(policy: Policy, subject: string | null): string {
  if (subject === null) {
    if (policy.needsSubject) throw new Error("Este intento necesita un sujeto.");
    return "";
  }
  return normalize(subject);
}

function keysFor(kind: AttemptKind, ip: string, subject: string | null): { keys: string[]; limits: number[]; policy: Policy } {
  const policy = POLICIES[kind];
  const who = subjectOf(policy, subject);
  const where = ip.slice(0, MAX_IP);
  return {
    policy,
    keys: policy.counters.map((counter) => keyOf(counter.bucket, counter.value(where, who))),
    limits: policy.counters.map((counter) => counter.limit),
  };
}

/**
 * Counts one attempt and, when a counter is over its cap, throws AppError RATE_LIMITED with `retryAt` (the end of the
 * farthest window) without the caller going on to Auth. `subject` is null only for `token`. For students the subject is
 * the pair (school code, username) written as one text, for example `${code}/${username}`.
 */
export async function guardAttempt(kind: AttemptKind, ip: string, subject: string | null): Promise<void> {
  const { keys, limits, policy } = keysFor(kind, ip, subject);
  const result = await hitAttempt(keys, limits, policy.windowSeconds);
  if (result.allowed) return;
  log.warn("rate_limit.blocked", { limitKind: kind });
  throw new AppError("RATE_LIMITED", DEFAULT_MESSAGES.RATE_LIMITED, { retryAt: new Date(result.retryAt).toISOString() });
}

/**
 * A success: clears the counters of that subject. The `*_subject` and `reset_email` counters always. The `*_pair` counter
 * has the IP in its key, so it is cleared only when the caller says which IP it was (every attempt counts before it is tried,
 * a success included, so without it a person who signs in often from one place would lock themselves out). The counters
 * of the IP alone (`reset_ip`, `token_ip`) are never cleared: a school shares its IP and a success must not reset them.
 */
export async function clearSubject(kind: AttemptKind, subject: string, ip?: string): Promise<void> {
  const who = normalize(subject);
  const where = ip?.slice(0, MAX_IP);
  const keys = POLICIES[kind].counters.flatMap((counter) => {
    if (counter.scope === "subject") return [keyOf(counter.bucket, counter.value("", who))];
    if (counter.scope === "pair" && where !== undefined) return [keyOf(counter.bucket, counter.value(where, who))];
    return [];
  });
  if (keys.length > 0) await clearAttempts(keys);
}
