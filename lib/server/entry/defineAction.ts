import "server-only";
import type { z } from "zod";
import type { Result } from "@/lib/errors";
import { newRequestId, runValidated } from "./run";

// Every Server Action is `export const x = defineAction({ name, input }, handler)` in an actions.ts
// with "use server". The handler gets validated input and calls one service; it never trusts the
// client for who the user is: services read the session again.

export type ActionSpec<S extends z.ZodType> = {
  /** Stable, dotted name for logs: "groups.create". */
  name: string;
  input: S;
};

export function defineAction<S extends z.ZodType, T>(
  spec: ActionSpec<S>,
  handler: (input: z.output<S>) => Promise<T>,
): (raw: z.input<S>) => Promise<Result<T>> {
  return async function action(raw) {
    const requestId = newRequestId();
    return runValidated({ entry: spec.name, requestId, schema: spec.input, raw }, handler);
  };
}
