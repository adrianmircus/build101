import "server-only";
import { hasValidToken, parseGateParams } from "./params";
import { newRequest, type GateRequest } from "./work";
import type { GateForm } from "./types";

const noStore = { "Cache-Control": "no-store" };

export const notFound = () => new Response(null, { status: 404, headers: noStore });

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: noStore });

/** Shared front door: 404 without a valid token, 400 with bad params in Spanish. */
export function admit(request: Request, form: GateForm): GateRequest | Response {
  if (!hasValidToken(request.headers.get("x-gate-token"))) return notFound();
  const parsed = parseGateParams(new URL(request.url));
  if (!parsed.success) {
    return json({ error: "Parámetros inválidos: hace falta un id (uuid), caller (server o browser) y seconds entre 1 y 55." }, 400);
  }
  return newRequest(form, parsed.data);
}
