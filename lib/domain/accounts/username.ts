// The username of a student: the first name plus the initial of the surname, without accents, lower case and only a-z0-9
// ("Lucía Fernández" gives luciaf). When it is taken: luciaf2, luciaf3... Pure: it receives the usernames already taken, which
// list_taken_usernames gives (T2.5a).

const MAX_BASE = 30;
/** The username rule of the database is ^[a-z0-9][a-z0-9._-]{1,39}$: two characters at least. */
const MIN_BASE = 2;
const FALLBACK = "alumno";

function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** «Fernández, Lucía» (surname first, with a comma) is read as «Lucía Fernández». */
function inOrder(displayName: string): string {
  const [surname, ...rest] = displayName.split(",");
  return rest.length > 0 && surname !== undefined ? `${rest.join(" ")} ${surname}` : displayName;
}

/**
 * The base of a name ("luciaf"), what list_taken_usernames receives: the first word plus the first letter of the last one. A name of a
 * single word is just that word. A name that leaves nothing, or one character, is completed so the base always fits the database rule.
 */
export function usernameBase(displayName: string): string {
  const words = inOrder(displayName)
    .split(/\s+/)
    .map(plain)
    .filter((word) => word.length > 0);
  const first = words[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1] ?? "") : "";
  const base = `${first}${last.slice(0, 1)}`.slice(0, MAX_BASE);
  if (base.length === 0) return FALLBACK;
  return base.length < MIN_BASE ? `${base}x` : base;
}

/**
 * The first free username for a name, given the taken ones (and the ones already suggested in the same batch: the caller adds each
 * answer to the set). The base first, then base2, base3...
 */
export function suggestUsername(displayName: string, taken: ReadonlySet<string>): string {
  const base = usernameBase(displayName);
  if (!taken.has(base)) return base;
  for (let number = 2; ; number += 1) {
    const candidate = `${base}${number}`;
    if (!taken.has(candidate)) return candidate;
  }
}
