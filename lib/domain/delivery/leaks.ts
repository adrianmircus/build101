import { STUDENT_DTO_ALLOWLISTS, STUDENT_DTO_SCHEMAS, type DtoAllowlist, type StudentDtoName } from "./student-dto";

// Walks a JSON value a student receives and reports every path that should not be there:
// - a key outside the DTO's allowlist, or a non-id key inside an id-keyed object (answers, choices);
// - a forbidden value (another student's id, a planted correct option) as a whole value OR as a key;
// - a forbidden word (a profile name) inside any text the server produced: titles, instructions,
//   exercise bodies, options, feedback. The student's own writing (ownContent) is exempt from the
//   word check only: what they wrote is theirs, but an id of someone else is a leak anywhere.
// Pure, so the leak test of the RPCs (T1.5d) and of the RSC payload (T4.8) share it.

export type LeakOptions = { forbiddenValues?: ReadonlySet<string>; forbiddenWords?: readonly string[] };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Walk = { allowlist: DtoAllowlist; forbidden: ReadonlySet<string>; words: readonly string[]; leaks: string[] };

/** Where the walk is: the JSON path, the key holding this value and whether it is the student's own text. */
type Place = { path: string; parentKey: string | undefined; own: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lower case, without accents, so «Dislexia», «DISLEXIA» and «dislexía» all match «dislexia». */
export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function hasWord(text: string, words: readonly string[]): boolean {
  const normalized = normalizeText(text);
  return words.some((word) => new RegExp(`(^|[^a-z0-9])${normalizeText(word)}([^a-z0-9]|$)`).test(normalized));
}

function keyLeaks(walk: Walk, key: string, place: Place): boolean {
  if (walk.forbidden.has(key)) return true;
  if (place.parentKey !== undefined && walk.allowlist.idKeyed.has(place.parentKey)) return !ID.test(key);
  return !walk.allowlist.keys.has(key);
}

function visitString(walk: Walk, value: string, place: Place): void {
  const leaks = walk.forbidden.has(value) || (!place.own && hasWord(value, walk.words));
  if (leaks) walk.leaks.push(place.path || "(root)");
}

function visit(walk: Walk, value: unknown, place: Place): void {
  if (typeof value === "string") return visitString(walk, value, place);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(walk, item, { ...place, path: `${place.path}.${index}` }));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const path = place.path === "" ? key : `${place.path}.${key}`;
    if (keyLeaks(walk, key, place)) walk.leaks.push(path);
    visit(walk, child, { path, parentKey: key, own: place.own || walk.allowlist.ownContent.has(key) });
  }
}

export function findLeaks(value: unknown, allowlist: DtoAllowlist, options: LeakOptions = {}): string[] {
  const walk: Walk = {
    allowlist,
    forbidden: options.forbiddenValues ?? new Set(),
    words: options.forbiddenWords ?? [],
    leaks: [],
  };
  visit(walk, value, { path: "", parentKey: undefined, own: false });
  return walk.leaks;
}

/**
 * The whole check of one DTO: its full structure against the strict schema (wrong or missing
 * fields included) and then findLeaks. Empty means clean.
 */
export function checkStudentDto(name: StudentDtoName, value: unknown, options: LeakOptions = {}): string[] {
  const parsed = STUDENT_DTO_SCHEMAS[name].safeParse(value);
  const structure = parsed.success ? [] : parsed.error.issues.map((issue) => `schema: ${issue.path.join(".") || "(root)"}`);
  return [...structure, ...findLeaks(value, STUDENT_DTO_ALLOWLISTS[name], options)];
}
