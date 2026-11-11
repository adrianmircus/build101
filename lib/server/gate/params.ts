import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const DEFAULT_SECONDS = 48;

export const gateParamsSchema = z.object({
  id: z.uuid(),
  caller: z.enum(["server", "browser"]),
  seconds: z.coerce.number().int().min(1).max(55).default(DEFAULT_SECONDS),
});

export type GateParams = z.infer<typeof gateParamsSchema>;

/** True only when GATE_TOKEN is set and the header matches it (constant-time compare). */
export function hasValidToken(headerValue: string | null, expected = process.env.GATE_TOKEN): boolean {
  if (!expected || !headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseGateParams(url: URL) {
  return gateParamsSchema.safeParse({
    id: url.searchParams.get("id"),
    caller: url.searchParams.get("caller"),
    seconds: url.searchParams.get("seconds") ?? undefined,
  });
}
