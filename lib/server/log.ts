import "server-only";
import { AppError } from "@/lib/errors";

// Structured, one JSON line per event, so the host's log search can filter by event and requestId.
// Logs leave our control (Netlify keeps them), so they never carry data about people: only ids that
// are already pseudonymous, codes and counts. It is an allowlist: a key is logged only if its name says
// it is an id, a count, a duration, a status and the like, so a new field is dropped until someone
// decides it is safe. Dropped, not masked, so a mistake can't leak a prefix.

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;
type Level = "info" | "warn" | "error";

const ALLOWED_SUFFIX = /(Id|Ids|Count|Ms|Tokens|Code|Status|Kind|Version)$/;
const ALLOWED_KEYS = new Set(["entry", "event", "attempt", "provider", "model", "route", "outcome", "errorType", "errorCode", "errorMessage", "errorFrame"]);
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

/**
 * Messages of foreign errors (drivers, JSON.parse, zod) embed the offending input, so they are never
 * logged. Only exact, known-safe texts may be added here; a message that merely looks harmless is not one.
 */
export const SAFE_ERROR_MESSAGES: Set<string> = new Set();

const FRAME_LINE = /^\s*at\s.*?\(?([^\s()]+):(\d+):\d+\)?\s*$/;
const FRAME_SHAPE = /^[\w@./:~ -]{1,200}:\d+$/;

function relativePath(raw: string): string {
  const path = raw.replace(/^file:\/+/, "").replaceAll("\\", "/");
  const root = process.cwd().replaceAll("\\", "/").replace(/^\/+/, "");
  const bare = path.replace(/^\/+/, "");
  return bare.startsWith(root) ? bare.slice(root.length).replace(/^\/+/, "") : bare;
}

function ownFrame(line: string): string | undefined {
  const match = FRAME_LINE.exec(line);
  const file = match?.[1];
  if (!file || !match[2] || file.includes("node_modules") || file.startsWith("node:")) return undefined;
  const frame = `${relativePath(file)}:${match[2]}`;
  return FRAME_SHAPE.test(frame) ? frame : undefined;
}

/** First stack frame in our own code as "path:line". The message is cut off first: it may hold anything. */
export function firstOwnFrame(error: Error): string | undefined {
  const stack = error.stack ?? "";
  const cut = error.message ? stack.lastIndexOf(error.message) : -1;
  const trace = cut >= 0 ? stack.slice(cut + error.message.length) : stack;
  return trace.split("\n").map(ownFrame).find((frame) => frame !== undefined);
}

/** Type, a structured code, a frame to debug with, and the message only when our own code wrote it. */
export function describeError(error: unknown): LogFields {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const code: unknown = Reflect.get(error, "code");
  const knownMessage = error instanceof AppError || SAFE_ERROR_MESSAGES.has(error.message);
  return {
    errorType: error.name,
    errorCode: typeof code === "string" && CODE_SHAPE.test(code) ? code : undefined,
    errorMessage: knownMessage ? error.message : undefined,
    errorFrame: firstOwnFrame(error),
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
