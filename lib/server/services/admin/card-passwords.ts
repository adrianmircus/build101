import "server-only";
import { unavailable } from "../../unavailable";

// The step per student of «Emitir tarjetas» (T2.5b): confirm the lease of the card, provision if the account is missing,
// put the new password and a new email in Auth, and close the sessions. If the confirmation says no, Auth is not touched.

/** `ok` is false when the card is no longer pending, the issue is not running, or the lease is short. The password never leaves this call. */
export async function applyCardPassword(issueId: string, studentId: string, password: string): Promise<{ ok: boolean }> {
  return unavailable(issueId, studentId, password);
}
