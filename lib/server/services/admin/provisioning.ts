import "server-only";
import type { ReconcileSummary } from "@/lib/domain/accounts/results";
import { unavailable } from "../../unavailable";

// Creating the Auth account of a student (T2.5b): claim the lease, remember the id, create or find the account, link.
// Nobody calls Auth without a lease with at least 4 minutes left (docs/contratos/fase-2.md, «El plazo de una operación con Auth»).

/** The steps of «Aprovisionar una cuenta de estudiante». `ready` is false when someone else holds the lease or the row is deleted. */
export async function provisionStudent(provisioningId: string, password?: string): Promise<{ ready: boolean }> {
  return unavailable(provisioningId, password);
}

/** internal_list_unfinished_accounts and provisionStudent for each; npm run admin:reconcile until phase 3. */
export async function reconcile(limit: number): Promise<ReconcileSummary> {
  return unavailable(limit);
}
