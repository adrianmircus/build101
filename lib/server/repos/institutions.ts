import "server-only";
import type { MyInstitution } from "@/lib/domain/identity/rpc";
import { callRpc, type RpcDb } from "./rpc";

// The institutions the logged-in person belongs to. No rules here: the database decides who sees what.

/** Active memberships only, in institutions that are open (an expired sandbox is not listed). */
export async function listMyInstitutions(db: RpcDb): Promise<MyInstitution[]> {
  const { items } = await callRpc(db, "list_my_institutions", {});
  return items;
}
