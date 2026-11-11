import "server-only";
import type { z } from "zod";
import { fail, type FailureCode, type Result } from "@/lib/errors";
import { newRequestId, runValidated } from "./run";

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

/** Dynamic segments of the URL, already resolved (/api/jobs/[id] gives { id }). */
export type RouteParams = Record<string, string | string[] | undefined>;
export type RouteContext = { params: Promise<RouteParams> };
export type RouteArgs = { request: Request; params: RouteParams };

export function defineRoute<S extends z.ZodType, T>(
  spec: RouteSpec<S>,
  handler: (input: z.output<S>, args: RouteArgs) => Promise<T>,
): (request: Request, context?: RouteContext) => Promise<Response> {
  return async function route(request, context) {
    const requestId = newRequestId();
    const params = (await context?.params) ?? {};
    const raw = await readRaw(request, spec.from);
    if (raw === undefined) return respond(fail("INVALID", "El pedido no es JSON válido.", { requestId }));
    return respond(await runValidated({ entry: spec.name, requestId, schema: spec.input, raw }, (input) => handler(input, { request, params })));
  };
}
