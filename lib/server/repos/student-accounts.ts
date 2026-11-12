import "server-only";
import type { RpcResult } from "@/lib/domain/rpc";
import { callRpc, type RpcDb } from "./rpc";

// The RPCs of the student accounts that run with the session of whoever asks (T2.5a). The database decides who may: an admin or
// the staff of the group, and never in a sandbox for the cards. A repo only translates names and types.

export type GroupAccounts = RpcResult<"list_group_accounts">;
export type IssuedRows = RpcResult<"issue_access_cards">;
export type CardToIssue = { studentId: string; tokenHash: string; passwordHash: string };

/** Which of these bases, or a base followed by digits, are already usernames of the institution. Up to 200 bases. */
export async function listTakenUsernames(db: RpcDb, institutionId: string, bases: string[]): Promise<string[]> {
  const { items } = await callRpc(db, "list_taken_usernames", { p_institution_id: institutionId, p_bases: bases });
  return items;
}

/** The students of a group with their accounts, and whether the actor may issue cards (the database says, with the rules of the issue). */
export async function listGroupAccounts(db: RpcDb, groupId: string): Promise<GroupAccounts> {
  return callRpc(db, "list_group_accounts", { p_group_id: groupId });
}

/** One transaction: revokes the cards, stores the new ones with the hash of the password and closes the sessions of those students. `tokenHash` is hex, without `\x`. */
export async function issueAccessCards(db: RpcDb, input: { groupId: string; cards: CardToIssue[]; opKey: string }): Promise<IssuedRows> {
  return callRpc(db, "issue_access_cards", { p_group_id: input.groupId, p_cards: input.cards, p_op_key: input.opKey });
}
