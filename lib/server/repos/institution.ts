import "server-only";
import { callRpc, type RpcDb } from "./rpc";

// The reads of the panel of an institution (T2.3). Only an admin of it gets an answer: the database checks.

export async function getInstitutionSummary(db: RpcDb, institutionId: string) {
  return callRpc(db, "get_institution_summary", { p_institution_id: institutionId });
}

export async function listInstitutionStaff(db: RpcDb, institutionId: string) {
  const { items } = await callRpc(db, "list_institution_staff", { p_institution_id: institutionId });
  return items;
}

/** The subjects that can be chosen for a new group. */
export async function listEnabledSubjects(db: RpcDb) {
  const { items } = await callRpc(db, "list_enabled_subjects", {});
  return items;
}
