import "server-only";
import type { z } from "zod";
import { fail, type FailureCode, type Result } from "@/lib/errors";
import { invalidInput, newRequestId, runEntry } from "./run";

// Route Handlers exist for what Server Actions can't do well: polling (actions run one at a time per
// client), webhooks, cron and streaming. Same contract as defineAction, answered as JSON.

export type RouteSpec<S extends z.ZodType> = {
  name: string;
  input: S;
  /** Where the input comes from: the JSON body or the query string. */
  from: "json" | "query";
};

const STATUS: Record<FailureCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  INTERNAL: 500,
  STALE_CLIENT: 409,
};

export function respond<T>(result: Result<T>): Response {
  const status = result.ok ? 200 : STATUS[result.code];
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

async function readRaw(request: Request, from: RouteSpec<z.ZodType>["from"]): Promise<unknown> {
  if (from === "query") return Object.fromEntries(new URL(request.url).searchParams);
  return request.json().catch(() => undefined);
}

export function defineRoute<S extends z.ZodType, T>(
  spec: RouteSpec<S>,
  handler: (input: z.output<S>, request: Request) => Promise<T>,
): (request: Request) => Promise<Response> {
  return async function route(request) {
    const requestId = newRequestId();
    const raw = await readRaw(request, spec.from);
    if (raw === undefined) return respond(fail("INVALID", "El pedido no es JSON válido.", { requestId }));
    const parsed = spec.input.safeParse(raw);
    if (!parsed.success) return respond(invalidInput(parsed.error, requestId));
    return respond(await runEntry(spec.name, requestId, () => handler(parsed.data, request)));
  };
}
