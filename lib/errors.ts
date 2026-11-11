// Expected failures travel as values (Result) so every caller has to handle them; only bugs throw.
// Shared by server and client: no imports, no IO.

export const ERROR_CODES = [
  "NOT_FOUND",
  "FORBIDDEN",
  "INVALID",
  "CONFLICT",
  "RATE_LIMITED",
  "UNAVAILABLE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** What the UI receives. INTERNAL is never raised on purpose: it is an unexpected error, already logged. */
export type FailureCode = ErrorCode | "INTERNAL" | "STALE_CLIENT";

export type Failure = {
  ok: false;
  code: FailureCode;
  message: string;
  /** Per-field messages for forms, keyed by the input path ("students.0.name"). */
  fields?: Record<string, string>;
  /** Lets support find the log line without the user sending any data. */
  requestId?: string;
};

export type Result<T> = { ok: true; data: T } | Failure;

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
  }
}

export const MESSAGES = {
  INTERNAL: "Algo falló de nuestro lado. Probá de nuevo en un rato.",
  INVALID: "Revisá los datos marcados.",
  CONFLICT: "Alguien cambió esto mientras lo editabas. Recargá para ver lo último.",
  STALE_CLIENT: "Se actualizó Tiza. Recargá la página.",
} as const;

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(code: FailureCode, message: string, extra?: Omit<Failure, "ok" | "code" | "message">): Failure {
  return { ok: false, code, message, ...extra };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

/** Unwraps a Result where a failure is a bug (tests, scripts). Never in request handling. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw new Error(`${result.code}: ${result.message}`);
}
