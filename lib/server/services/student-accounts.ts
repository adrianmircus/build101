import "server-only";
import type { AccountRow, UsernameDraft } from "@/lib/domain/accounts/entities";
import type { NewStudent } from "@/lib/domain/accounts/inputs";
import type { CreatedAccountRow, IssuedCards } from "@/lib/domain/accounts/results";
import { unavailable } from "../unavailable";

// Accounts of students (T2.5b). Every operation with the admin client uses ids that an RPC called with the session
// of the actor already authorized. The answer of issueAccessCards is never cached, never logged, and never in an error.

export type IssueAccessCards = { groupId: string; studentIds: string[]; opKey: string; origin: string };

/** The "revisar" step: a username per name (list_taken_usernames and the pure rule), repeats in the batch included. */
export async function previewUsernames(input: { institutionId: string; names: string[] }): Promise<UsernameDraft[]> {
  return unavailable(input);
}

/** create_student per row (op_key from the one of the request and the index of the row, UUID v5), then provisioning without password. One result per row. */
export async function createStudentAccounts(input: { groupId: string; rows: NewStudent[]; opKey: string }): Promise<CreatedAccountRow[]> {
  return unavailable(input);
}

/** The accounts of a group, for the list of the cards page (list_group_accounts). */
export async function listGroupAccounts(groupId: string): Promise<{ groupName: string; institutionCode: string; items: AccountRow[] }> {
  return unavailable(groupId);
}

/** begin_access_cards, the step per student (claim, provision, password, close sessions) and finish_access_cards. Passwords and QR urls live only in the answer. */
export async function issueAccessCards(input: IssueAccessCards): Promise<IssuedCards> {
  return unavailable(input);
}
