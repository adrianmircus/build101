// The school a student already used on this device, so from the second time there are two fields instead of three.
// Only { code, name } is stored: never the username, a password or anything else about the student.

export type RememberedSchool = { code: string; name: string };

const KEY = "tiza.school";
const CODE = /^[a-z0-9][a-z0-9-]{2,31}$/;
const MAX_NAME = 120;
const listeners = new Set<() => void>();

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage (private mode, policy): the login still works, it just forgets.
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

/** The stored text as is, so React can compare it by value. */
export function readRememberedRaw(): string | null {
  try {
    return store()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

function asSchool(value: unknown): RememberedSchool | null {
  if (typeof value !== "object" || value === null || !("code" in value) || !("name" in value)) return null;
  const { code, name } = value;
  if (typeof code !== "string" || typeof name !== "string") return null;
  const trimmed = name.trim();
  return CODE.test(code) && trimmed !== "" && trimmed.length <= MAX_NAME ? { code, name: trimmed } : null;
}

/** Anything that is not exactly a school code and a name is ignored. */
export function parseRememberedSchool(raw: string | null | undefined): RememberedSchool | null {
  if (!raw) return null;
  try {
    return asSchool(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function readRememberedSchool(): RememberedSchool | null {
  return parseRememberedSchool(readRememberedRaw());
}

export function rememberSchool(school: RememberedSchool): void {
  const clean = parseRememberedSchool(JSON.stringify({ code: school.code.trim().toLowerCase(), name: school.name }));
  if (!clean) return;
  try {
    store()?.setItem(KEY, JSON.stringify({ code: clean.code, name: clean.name }));
  } catch {
    return; // full or blocked: nothing to remember, nothing to tell the student.
  }
  notify();
}

export function forgetSchool(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    return;
  }
  notify();
}

export function subscribeRememberedSchool(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}
