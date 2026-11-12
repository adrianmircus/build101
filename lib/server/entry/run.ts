import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { AppError, MESSAGES, fail, ok, type Failure, type Result } from "@/lib/errors";
import { describeError, log } from "@/lib/server/log";
import { spanishIssueMessage } from "./messages";

// The shared core of defineAction and defineRoute: validate, run, and turn every outcome into a Result.
// Expected errors (AppError) keep their code and message; anything else is a bug, logged with a request id
// and shown to the user as a generic message so internals never reach the browser.

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** safeParse with Spanish defaults: messages written in a schema still win over them. */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown) {
  return schema.safeParse(raw, { error: spanishIssueMessage });
}

export function invalidInput(error: z.ZodError, requestId: string): Failure {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".");
    fields[path] ??= issue.message;
  }
  return fail("INVALID", MESSAGES.INVALID, { fields, requestId });
}

export function toFailure(entry: string, requestId: string, error: unknown): Failure {
  // redirect() and notFound() throw on purpose: they must reach Next untouched.
  unstable_rethrow(error);
  if (error instanceof AppError) {
    return fail(error.code, error.message, error.retryAt === undefined ? { requestId } : { requestId, retryAt: error.retryAt });
  }
  log.error("entry.unexpected", { entry, requestId, ...describeError(error) });
  return fail("INTERNAL", MESSAGES.INTERNAL, { requestId });
}

export async function runEntry<T>(entry: string, requestId: string, work: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await work());
  } catch (error) {
    return toFailure(entry, requestId, error);
  }
}

/** Parse and run inside one try: a schema transform that throws is a bug like any other, not a crash. */
type Parsing<S extends z.ZodType> = { entry: string; requestId: string; schema: S; raw: unknown };

export async function runValidated<S extends z.ZodType, T>(
  { entry, requestId, schema, raw }: Parsing<S>,
  handler: (input: z.output<S>) => Promise<T>,
): Promise<Result<T>> {
  try {
    const parsed = parseInput(schema, raw);
    if (!parsed.success) return invalidInput(parsed.error, requestId);
    return ok(await handler(parsed.data));
  } catch (error) {
    return toFailure(entry, requestId, error);
  }
}
