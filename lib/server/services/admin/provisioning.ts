import "server-only";
import type { ReconcileSummary } from "@/lib/domain/accounts/results";
import { unavailable } from "../../unavailable";

// Creating the Auth account of a student (T2.5b), without a password: remember the id, ask Auth, create it if it is not
// there, link. createStudentAccounts does not provision: the account is born with the first card, or here with `reconcile`
// (docs/contratos/fase-2.md, «Aprovisionar una cuenta de estudiante»). Repeating it is safe: two at once converge.

/**
 * `active`: the account exists and is linked. `failed`: Auth refused or the account is not ours (account_mismatch); the row
 * is marked. `uncertain`: Auth did not answer; nothing is marked and `reconcile` takes it up.
 */
export async function provisionStudent(provisioningId: string): Promise<"active" | "failed" | "uncertain"> {
  return unavailable(provisioningId);
}

/** internal_list_unfinished_accounts (only rows that started and did not finish) and provisionStudent for each; npm run admin:reconcile until phase 3. */
export async function reconcile(limit: number): Promise<ReconcileSummary> {
  return unavailable(limit);
}
