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
  if (error instanceof AppError) return fail(error.code, error.message, { requestId });
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
