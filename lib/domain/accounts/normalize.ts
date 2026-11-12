import { notImplemented } from "./not-implemented";

// What the login does with what was typed, before it asks anyone (T2.5b). Pure.

/**
 * The password of a student as typed: lower case, no spaces at the edges, and any run of spaces or hyphens becomes one
 * hyphen. The password is born in that format, so normalizing loses nothing.
 */
export function normalizePassword(typed: string): string {
  return notImplemented(typed);
}

/** The subject of the attempt counters of a student: the pair (school code, username), normalized. */
export function studentSubject(code: string, username: string): string {
  return notImplemented(code, username);
}
