import { notImplemented } from "./not-implemented";

// The username of a student: the first name plus the initial of the surname, without accents, lower case and
// only a-z0-9 ("Lucía Fernández" gives luciaf). When it is taken: luciaf2, luciaf3... Pure: it receives the
// usernames already taken, which list_taken_usernames gives. Implemented by T2.5b.

/** The base of a name ("luciaf"), what list_taken_usernames receives. */
export function usernameBase(displayName: string): string {
  return notImplemented(displayName);
}

/** The first free username for a name, given the taken ones (and the ones already suggested in the same batch). */
export function suggestUsername(displayName: string, taken: ReadonlySet<string>): string {
  return notImplemented(displayName, taken);
}
