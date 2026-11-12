import { STUDENT_DTO_ALLOWLISTS, STUDENT_DTO_SCHEMAS, type DtoAllowlist, type StudentDtoName } from "./student-dto";

// The automated leak test guarantees only what is structural and provable (docs/contratos/fase-1.md,
// «Prueba de fugas»). It walks a JSON value a student receives and reports every path where:
// - a key is outside the DTO's allowlist, or a non-id key sits inside an id-keyed object (answers,
//   choices). No key, rubric or expected answer can travel: no such field exists in the allowlist;
// - a forbidden id (another student, a pseudonym, a need, a key, a version not assigned) appears
//   anywhere: as a value, as a key or embedded in any text, the student's own writing included;
// - a profile word appears in text the server wrote (the student's own writing is exempt);
// - a correct option id appears in an id-typed field other than the option list and the student's
//   own choice.
// Whether teacher-approved free text states a solution is a content question, not a leak: see
// reveal.ts, which only warns. Pure, so the RPC test (T1.5d) and the RSC payload test (T4.8) share it.

export type LeakOptions = {
  forbiddenIds?: ReadonlySet<string>;
  forbiddenWords?: readonly string[];
  /** The correct option ids of the task's questions. */
  correctOptionIds?: ReadonlySet<string>;
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Where an option id is legitimately visible: the options themselves and the student's own choice. */
const OPTION_PLACES = [/^questions\.\d+\.options\.\d+\.id$/, /^draft\.choices\.[^.]+$/];

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

function isIdField(walk: Walk, place: Place): boolean {
  const key = place.parentKey ?? "";
  return key === "id" || key.endsWith("Id") || walk.allowlist.idKeyed.has(place.path.split(".").at(-2) ?? "");
}

function correctOptionLeaks(walk: Walk, value: string, place: Place): boolean {
  if (!walk.options.correctOptionIds.has(value) || !isIdField(walk, place)) return false;
  return !OPTION_PLACES.some((pattern) => pattern.test(place.path));
}

function keyLeaks(walk: Walk, key: string, place: Place): boolean {
  if (hasForbiddenId(key, walk.options.forbiddenIds)) return true;
  if (place.parentKey !== undefined && walk.allowlist.idKeyed.has(place.parentKey)) return !ID.test(key);
  return !walk.allowlist.keys.has(key);
}

function stringLeaks(walk: Walk, value: string, place: Place): boolean {
  if (hasForbiddenId(value, walk.options.forbiddenIds)) return true;
  if (!place.own && hasWord(value, walk.options.forbiddenWords)) return true;
  return correctOptionLeaks(walk, value, place);
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
    correctOptionIds: options.correctOptionIds ?? new Set(),
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
