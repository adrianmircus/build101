import "server-only";
import { randomInt } from "node:crypto";
import type { AccountRow, UsernameDraft } from "@/lib/domain/accounts/entities";
import type { NewStudent } from "@/lib/domain/accounts/inputs";
import { generateInitialPassword } from "@/lib/domain/accounts/password";
import type { CreatedAccountRow, IssuedCards, OtherCard } from "@/lib/domain/accounts/results";
import { suggestUsername, usernameBase } from "@/lib/domain/accounts/username";
import { DEFAULT_MESSAGES, REASON_MESSAGES } from "@/lib/domain/errors/reasons";
import { AppError } from "@/lib/errors";
import { hashPassword } from "../auth/password-hash";
import { deriveOpKey, hashToken, newToken } from "../auth/tokens";
import { log } from "../log";
import { sessionDb } from "../repos/db";
import * as repo from "../repos/student-accounts";
import { createStudent } from "../repos/students";
import { provisionMissing } from "./admin/provisioning";

// Accounts of students (T2.5b). Every operation with the admin client uses ids that an RPC called with the session
// of the actor already authorized. The answer of issueAccessCards is never cached, never logged, and never in an error:
// the passwords exist only in the memory of this call and in the answer.

export type IssueAccessCards = { groupId: string; studentIds: string[]; opKey: string; origin: string };
export type GroupAccounts = { groupName: string; institutionCode: string; canIssueCards: boolean; items: AccountRow[] };

const NOT_ALLOWED = "No podés crear tarjetas en este grupo. En la demo tampoco se pueden crear.";

/** The "revisar" step: a username per name (list_taken_usernames and the pure rule), repeats in the batch included. */
export async function previewUsernames(input: { institutionId: string; names: string[] }): Promise<UsernameDraft[]> {
  const bases = [...new Set(input.names.map(usernameBase))];
  const taken = new Set(await repo.listTakenUsernames(await sessionDb(), input.institutionId, bases));
  return input.names.map((displayName) => {
    const username = suggestUsername(displayName, taken);
    // The next person with the same base gets the next number, even if the admin edits this one later.
    taken.add(username);
    return { displayName: displayName.trim(), username };
  });
}

/** A rejection that says «this person may not do this» holds for every row: it is not a failed row. */
const WHOLE_REQUEST = new Set(["FORBIDDEN", "NOT_FOUND", "RATE_LIMITED"]);

/** create_student per row (op_key from the one of the request and the index of the row, UUID v5), then provisioning without password. One result per row. */
export async function createStudentAccounts(input: { groupId: string; rows: NewStudent[]; opKey: string }): Promise<CreatedAccountRow[]> {
  const db = await sessionDb();
  const results: CreatedAccountRow[] = [];
  // One after the other: each create_student takes its own locks, and the order of the rows is the one the admin reviewed.
  for (const [index, row] of input.rows.entries()) {
    try {
      const created = await createStudent(db, input.groupId, { displayName: row.displayName, username: row.username, opKey: deriveOpKey(input.opKey, String(index)) });
      results.push({ index, outcome: "created", studentId: created.id });
    } catch (thrown) {
      if (thrown instanceof AppError && WHOLE_REQUEST.has(thrown.code)) throw thrown;
      const taken = thrown instanceof AppError && thrown.code === "CONFLICT" && thrown.message === REASON_MESSAGES.username_taken;
      log.warn("student_accounts.row_failed", { outcome: taken ? "username_taken" : "failed", errorType: thrown instanceof Error ? thrown.name : "unknown" });
      results.push({ index, outcome: taken ? "username_taken" : "failed", studentId: null });
    }
  }
  return results;
}

/** The accounts of a group, for the list of the cards page (list_group_accounts), with whether the actor may issue cards. */
export async function listGroupAccounts(groupId: string): Promise<GroupAccounts> {
  return repo.listGroupAccounts(await sessionDb(), groupId);
}

/**
 * The cards of the students of a group, in the steps of docs/contratos/fase-2.md, «Emitir tarjetas»:
 * 1. With the session, `list_group_accounts`: `canIssueCards` must be true and every student asked for must be in the list. If not,
 *    it ends (FORBIDDEN or NOT_FOUND) before any call with the admin client.
 * 2. Whoever has no account yet gets one (provisioning). Those that do not end `active` do not get a card: they come back in `others`.
 * 3. A token and a password per student, and the hash of each.
 * 4. `issue_access_cards`, in one transaction, with the session of the actor. It writes nothing in Auth.
 * 5. The cards, with the password and the QR url. They live only in this answer.
 */
export async function issueAccessCards(input: IssueAccessCards): Promise<IssuedCards> {
  const studentIds = [...new Set(input.studentIds)];
  const db = await sessionDb();

  const group = await repo.listGroupAccounts(db, input.groupId);
  if (!group.canIssueCards) throw new AppError("FORBIDDEN", NOT_ALLOWED);
  const listed = new Map(group.items.map((item) => [item.studentId, item]));
  if (studentIds.some((id) => !listed.has(id))) throw new AppError("NOT_FOUND", DEFAULT_MESSAGES.NOT_FOUND);

  // From here on the ids are authorized: they are students of a group the actor may issue cards in.
  const { ready, others } = await provisionAll(studentIds, listed);
  if (ready.length === 0) return { cards: [], others };

  const secrets = await Promise.all(
    ready.map(async (studentId) => {
      const token = newToken();
      const password = generateInitialPassword(randomInt);
      return { studentId, token, password, passwordHash: await hashPassword(password) };
    }),
  );
  const issued = await repo.issueAccessCards(db, {
    groupId: input.groupId,
    // The database wants the hash of the token as hex, without the `\x` of a bytea parameter.
    cards: secrets.map(({ studentId, token, passwordHash }) => ({ studentId, tokenHash: hashToken(token).slice(2), passwordHash })),
    opKey: input.opKey,
  });

  const byStudent = new Map(secrets.map((secret) => [secret.studentId, secret]));
  const cards = issued.items.flatMap((item) => {
    const secret = byStudent.get(item.studentId);
    if (secret === undefined) return [];
    return [
      {
        studentId: item.studentId,
        displayName: item.displayName,
        username: item.username,
        institutionCode: issued.institutionCode,
        institutionName: issued.institutionName,
        password: secret.password,
        qrUrl: `${input.origin}/t#${secret.token}`,
      },
    ];
  });
  return { cards, others };
}

/** Gives an account to every student that has none; the answer is who is ready for a card and who is not, and why. */
async function provisionAll(studentIds: string[], listed: ReadonlyMap<string, AccountRow>): Promise<{ ready: string[]; others: OtherCard[] }> {
  const active = new Set(studentIds.filter((id) => listed.get(id)?.accountStatus === "active"));
  const outcomes = await provisionMissing(studentIds, active);
  const ready = studentIds.filter((id) => outcomes.get(id) === "active");
  const others = studentIds.flatMap((studentId): OtherCard[] => {
    const outcome = outcomes.get(studentId);
    return outcome === "active" ? [] : [{ studentId, outcome: outcome === "uncertain" ? "uncertain" : "failed" }];
  });
  return { ready, others };
}
