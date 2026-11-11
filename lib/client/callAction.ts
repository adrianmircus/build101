import { unstable_isUnrecognizedActionError, unstable_rethrow } from "next/navigation";
import { MESSAGES, fail, type Result } from "@/lib/errors";

// Client side of defineAction. After a deploy, a tab still running the old build calls an action id
// that no longer exists: we answer STALE_CLIENT so the UI offers a reload and keeps what the user typed.
// A dropped connection (fetch rejects with a TypeError) becomes UNAVAILABLE instead of an unhandled
// rejection. When an action calls redirect() Next throws on purpose in the client: it must go through.

export async function callAction<I, T>(action: (input: I) => Promise<Result<T>>, input: I): Promise<Result<T>> {
  try {
    return await action(input);
  } catch (error) {
    unstable_rethrow(error);
    if (unstable_isUnrecognizedActionError(error)) return fail("STALE_CLIENT", MESSAGES.STALE_CLIENT);
    if (error instanceof TypeError) return fail("UNAVAILABLE", "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.");
    return fail("INTERNAL", MESSAGES.INTERNAL);
  }
}
