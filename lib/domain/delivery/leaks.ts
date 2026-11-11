import type { DtoAllowlist } from "./student-dto";

// Walks a JSON value a student receives and reports every path that should not be there: a key
// outside the DTO's allowlist, a non-id key inside an id-keyed object (answers, choices), or a
// value from the forbidden list (another student's id, a profile id, a correct option the test
// planted). Pure, so the leak test of the RPCs (T1.5d) and of the RSC payload (T4.8) share it.

export type LeakOptions = { forbiddenValues?: ReadonlySet<string> };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Walk = { allowlist: DtoAllowlist; forbidden: ReadonlySet<string>; leaks: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keyLeaks(walk: Walk, key: string, parentKey: string | undefined): boolean {
  if (parentKey !== undefined && walk.allowlist.idKeyed.has(parentKey)) return !ID.test(key);
  return !walk.allowlist.keys.has(key);
}

/** Where the walk is: the JSON path so far and the key of the object that holds this value. */
type Place = { path: string; parentKey: string | undefined };

function visit(walk: Walk, value: unknown, { path, parentKey }: Place): void {
  if (typeof value === "string" && walk.forbidden.has(value)) walk.leaks.push(path || "(root)");
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(walk, item, { path: `${path}.${index}`, parentKey }));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "" ? key : `${path}.${key}`;
    if (keyLeaks(walk, key, parentKey)) walk.leaks.push(childPath);
    visit(walk, child, { path: childPath, parentKey: key });
  }
}

export function findLeaks(value: unknown, allowlist: DtoAllowlist, options: LeakOptions = {}): string[] {
  const walk: Walk = { allowlist, forbidden: options.forbiddenValues ?? new Set(), leaks: [] };
  visit(walk, value, { path: "", parentKey: undefined });
  return walk.leaks;
}
