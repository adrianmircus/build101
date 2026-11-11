import "server-only";

// Structured, one JSON line per event, so the host's log search can filter by event and requestId.
// Logs leave our control (Netlify keeps them), so they never carry data about people: only ids that
// are already pseudonymous, codes and counts. Keys that look like personal data are dropped, not masked,
// so a mistake can't leak a prefix.

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;
type Level = "info" | "warn" | "error";

const SENSITIVE_KEY = /name|email|mail|phone|profile|perfil|answer|respuesta|text|prompt|content|token|password|secret|key|cookie|auth/i;
const MAX_STRING = 300;

export function sanitize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) continue;
    out[key] = typeof value === "string" ? value.slice(0, MAX_STRING) : value;
  }
  return out;
}

/** Type and message only: driver errors put row values in `detail`, which we never read. */
export function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorType: error.name, errorMessage: error.message.slice(0, MAX_STRING) };
  }
  return { errorType: typeof error };
}

function write(level: Level, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...sanitize(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
