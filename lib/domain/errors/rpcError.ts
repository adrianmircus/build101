import { isErrorCode, type ErrorCode } from "@/lib/errors";
import { messageFor } from "./reasons";

// Translates what PostgREST returns for a failed RPC into an expected error, or null when it is
// not one (a bug, a constraint the RPC should have caught, a timeout). The repos turn a non-null
// result into AppError(code, message) and anything else into an unexpected error, logged by code.
//
// Only P0001 with a known code as message counts. A plain RAISE EXCEPTION 'text with data' also
// has SQLSTATE P0001, but its message is not a code, so it never reaches the user.

export type RpcErrorLike = { code?: string | null; message?: string | null; details?: string | null };

export type ExpectedRpcError = { code: ErrorCode; reason: string | undefined; message: string };

const REASON = /^[a-z][a-z0-9_]{1,62}$/;

export function parseRpcError(error: RpcErrorLike): ExpectedRpcError | null {
  if (error.code !== "P0001" || !isErrorCode(error.message)) return null;
  const reason = typeof error.details === "string" && REASON.test(error.details) ? error.details : undefined;
  return { code: error.message, reason, message: messageFor(error.message, reason) };
}
