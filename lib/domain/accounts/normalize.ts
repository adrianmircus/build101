// What the login does with what was typed, before it asks anyone (T2.5b). Pure.

/**
 * The password of a student as typed: lower case, no spaces at the edges, and any run of spaces or hyphens becomes one
 * hyphen. The password is born in that format, so normalizing loses nothing: «Sol Nube  Tigre-47» and «sol-nube-tigre-47» are the same.
 */
export function normalizePassword(typed: string): string {
  return typed.trim().toLowerCase().replace(/[\s-]+/g, "-");
}

/**
 * The subject of the attempt counters of a student: the pair (school code, username), normalized. «Colegio-X / LuciaF » and
 * «colegio-x/luciaf» count together, so spaces and capitals do not make a new counter.
 */
export function studentSubject(code: string, username: string): string {
  return `${code.trim().toLowerCase()}/${username.trim().toLowerCase()}`;
}
