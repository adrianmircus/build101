import { STUDENT_DTO_ALLOWLISTS, STUDENT_DTO_SCHEMAS, type DtoAllowlist, type StudentDtoName } from "./student-dto";

// Walks a JSON value a student receives and reports every path that should not be there:
// - a key outside the DTO's allowlist, or a non-id key inside an id-keyed object (answers, choices);
// - a forbidden id (another student, a pseudonym, a version) anywhere: as a value, as a key or
//   embedded in any text, the student's own writing included ("Referencia: <id>");
// - a profile word inside any text the server produced (titles, instructions, bodies, options,
//   feedback). The student's own writing (ownContent) is exempt from this check only;
// - a secret outside the places where its value is legitimately visible. A correct option "A" is
//   also a visible option id and maybe the student's own choice: it may appear exactly there and
//   nowhere else. The same for an expected answer, allowed only in the student's own answers.
// Pure, so the leak test of the RPCs (T1.5d) and of the RSC payload (T4.8) share it.

/** allowedAt: path patterns where the value may appear; * matches one segment ("questions.*.options.*.id"). */
export type Secret = { value: string; allowedAt: readonly string[] };

export type LeakOptions = {
  forbiddenIds?: ReadonlySet<string>;
  forbiddenWords?: readonly string[];
  secrets?: readonly Secret[];
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Walk = { allowlist: DtoAllowlist; options: Required<LeakOptions>; leaks: string[] };

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

function hasForbiddenId(text: string, ids: ReadonlySet<string>): boolean {
  const lower = text.toLowerCase();
  return [...ids].some((id) => lower.includes(id.toLowerCase()));
}

export function matchesPath(path: string, pattern: string): boolean {
  const parts = path.split(".");
  const wanted = pattern.split(".");
  return parts.length === wanted.length && wanted.every((segment, index) => segment === "*" || segment === parts[index]);
}

function secretLeaks(secrets: readonly Secret[], value: string, path: string): boolean {
  return secrets.some((secret) => secret.value === value && !secret.allowedAt.some((pattern) => matchesPath(path, pattern)));
}

function keyLeaks(walk: Walk, key: string, place: Place): boolean {
  if (hasForbiddenId(key, walk.options.forbiddenIds)) return true;
  if (place.parentKey !== undefined && walk.allowlist.idKeyed.has(place.parentKey)) return !ID.test(key);
  return !walk.allowlist.keys.has(key);
}

function stringLeaks(walk: Walk, value: string, place: Place): boolean {
  const { forbiddenIds, forbiddenWords, secrets } = walk.options;
  if (hasForbiddenId(value, forbiddenIds)) return true;
  if (!place.own && hasWord(value, forbiddenWords)) return true;
  return secretLeaks(secrets, value, place.path);
}

function visit(walk: Walk, value: unknown, place: Place): void {
  if (typeof value === "string") {
    if (stringLeaks(walk, value, place)) walk.leaks.push(place.path || "(root)");
    return;
  }
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
  const full: Required<LeakOptions> = {
    forbiddenIds: options.forbiddenIds ?? new Set(),
    forbiddenWords: options.forbiddenWords ?? [],
    secrets: options.secrets ?? [],
  };
  const walk: Walk = { allowlist, options: full, leaks: [] };
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
