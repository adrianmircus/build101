import "server-only";

// Structured, one JSON line per event, so the host's log search can filter by event and requestId.
// Logs leave our control (Netlify keeps them), so they never carry data about people: only ids that
// are already pseudonymous, codes and counts. It is an allowlist: a key is logged only if its name says
// it is an id, a count, a duration, a status and the like, so a new field is dropped until someone
// decides it is safe. Dropped, not masked, so a mistake can't leak a prefix.

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;
type Level = "info" | "warn" | "error";

const ALLOWED_SUFFIX = /(Id|Ids|Count|Ms|Tokens|Code|Status|Kind|Version)$/;
const ALLOWED_KEYS = new Set(["entry", "event", "attempt", "provider", "model", "route", "outcome", "errorType", "errorCode", "errorMessage"]);
const MAX_STRING = 300;
const CODE_SHAPE = /^[A-Za-z0-9_.:-]{1,40}$/;

export function sanitize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_KEYS.has(key) && !ALLOWED_SUFFIX.test(key)) continue;
    out[key] = typeof value === "string" ? value.slice(0, MAX_STRING) : value;
  }
  return out;
}

/** Everything quoted is a value (Postgres, JSON.parse and zod all quote the offending input). */
export function redactQuoted(message: string): string {
  return message
    .replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”|‘[^’]*’/g, "…")
    .replace(/["'`“‘][\s\S]*$/, "…")
    .slice(0, MAX_STRING);
}

/** Type, a short structured code and the message without quoted values: driver errors embed row values. */
export function describeError(error: unknown): LogFields {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const code: unknown = Reflect.get(error, "code");
  return {
    errorType: error.name,
    errorCode: typeof code === "string" && CODE_SHAPE.test(code) ? code : undefined,
    errorMessage: redactQuoted(error.message),
  };
}

function write(level: Level, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({ ...sanitize(fields), level, event, time: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
