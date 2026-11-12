import "server-only";
import type { ReconcileSummary } from "@/lib/domain/accounts/results";
import { unavailable } from "../../unavailable";

// Creating the Auth account of a student (T2.5b), always under the one lease of the student (internal_claim_account):
// remember the id, create or find the account, link. createStudentAccounts does not provision: the account is born with the
// first card, or here with `reconcile`. Nobody calls Auth without confirming the lease first (docs/contratos/fase-2.md,
// «La reserva de la cuenta de un estudiante»).

export type ProvisionStudent = {
  provisioningId: string;
  /** Chosen by the caller: the issue_id of a card issue, or a new uuid for a loose provisioning. */
  holder: string;
  password?: string | undefined;
};

/** The steps of «Aprovisionar una cuenta de estudiante». `ready` is false when the lease is someone else's or the row is deleted. */
export async function provisionStudent(input: ProvisionStudent): Promise<{ ready: boolean }> {
  return unavailable(input);
}

/** internal_list_unfinished_accounts and provisionStudent for each; npm run admin:reconcile until phase 3. */
export async function reconcile(limit: number): Promise<ReconcileSummary> {
  return unavailable(limit);
}
