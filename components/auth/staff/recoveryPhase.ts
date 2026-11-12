import { callAction } from "@/lib/client/callAction";
import type { RecoveryVerified } from "@/lib/domain/accounts/results";
import type { ActionFn } from "./actionFn";
import { failureText } from "./failureText";

const RETRYABLE = ["UNAVAILABLE", "INTERNAL", "STALE_CLIENT", "RATE_LIMITED"];

export type RecoveryPhase = { kind: "checking" } | { kind: "expired" } | { kind: "ready"; userId: string } | { kind: "error"; text: string };

/**
 * Asks the server if the recovery link still works. No hash, or a link that is gone (not found, forbidden, invalid):
 * «expired». Only a failure that is not about the link (no connection, too many tries, a stale page) can be tried again.
 */
export async function recoveryPhaseFor(verify: ActionFn<{ tokenHash: string }, RecoveryVerified>, tokenHash: string): Promise<RecoveryPhase> {
  if (tokenHash === "") return { kind: "expired" };
  const result = await callAction(verify, { tokenHash });
  if (result.ok) return { kind: "ready", userId: result.data.userId };
  return RETRYABLE.includes(result.code) ? { kind: "error", text: failureText(result) } : { kind: "expired" };
}
