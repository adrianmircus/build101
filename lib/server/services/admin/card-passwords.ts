import "server-only";
import { unavailable } from "../../unavailable";

// The step per student of «Emitir tarjetas» (T2.5b): claim the lease of the student with the issue as holder, provision if
// the account is missing, put the new password and a new email in Auth, and close the sessions. If the claim says no, Auth
// is not touched.

export type ApplyCardPassword = { issueId: string; studentId: string; password: string };

/**
 * `done`: the password and the email changed. `failed`: a confirmed rejection (or the lease was not ours): the card is not
 * printed and the student can be asked again. `uncertain`: Auth did not answer in time: the card is not printed either, and
 * the lease keeps the student blocked until it expires. The password never leaves this call.
 */
export async function applyCardPassword(input: ApplyCardPassword): Promise<"done" | "failed" | "uncertain"> {
  return unavailable(input);
}
