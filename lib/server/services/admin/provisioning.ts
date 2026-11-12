import "server-only";
import { randomUUID } from "node:crypto";
import { studentEmail } from "@/lib/domain/accounts/email";
import type { ReconcileSummary } from "@/lib/domain/accounts/results";
import { AppError } from "@/lib/errors";
import { mapLimit } from "../../concurrency";
import { log } from "../../log";
import { AuthAdminError, type AuthUser, createAuthUser, getAuthUser } from "../../repos/admin/auth-users";
import { adminDb } from "../../repos/admin/db";
import { upsertAppUser } from "../../repos/admin/identity";
import { failStudentAccount, getStudentAccounts, listUnfinishedAccounts, rememberStudentAccount } from "../../repos/admin/student-accounts";
import { linkStudentUser } from "../../repos/admin/students";

// Creating the Auth account of a student (T2.5b), without a password: remember the id, ask Auth, create it if it is not
// there, link. createStudentAccounts does not provision: the account is born with the first card, or here with `reconcile`
// (docs/contratos/fase-2.md, «Aprovisionar una cuenta de estudiante»). Repeating it is safe: two at once converge, because the id
// is decided and remembered before Auth hears of it, and the account has no password or anything else that could be overwritten.
// Nothing here logs an id of Auth, an email or a username: only the outcome.

export type ProvisionInput = { studentId: string; provisioningId: string };
export type Provisioned = "active" | "failed" | "uncertain";

/** The rows that can be provisioned: anything that is not erased (`deleted`) and not a sandbox row. */
const PROVISIONABLE = new Set(["pending", "failed", "active"]);
const PROVISION_LANES = 6;
const RECONCILE_LANES = 4;

/** The account that Auth has under the remembered id is ours when it carries this provisioning id in its app_metadata. */
function isOurs(user: AuthUser, provisioningId: string): boolean {
  return user.appMetadata.provisioning_id === provisioningId;
}

/**
 * `active`: the account exists and is linked. `failed`: Auth refused, the account is not ours (account_mismatch) or the row is
 * not one that can be provisioned (it does not exist, it is `deleted`: a suppressed account is never created again); the row is
 * marked when it can be. `uncertain`: Auth did not answer or answered something that says nothing about us; nothing is marked and
 * `reconcile` takes it up.
 *
 * `provisioningId` must be the one of that student: a row that does not exist or is not in `pending`, `failed` or `active` is
 * dropped before Auth is called.
 */
export async function provisionStudent(input: ProvisionInput): Promise<Provisioned> {
  try {
    return await provision(input);
  } catch (thrown) {
    // An outage, a timeout or an answer of Auth that is not about what we sent says nothing about this student.
    log.warn("provisioning.uncertain", { errorType: thrown instanceof Error ? thrown.name : "unknown", errorCode: thrown instanceof AuthAdminError ? thrown.kind : undefined });
    return "uncertain";
  }
}

type Claim = { authUserId: string } | { outcome: Provisioned };

/** Steps 1 and 2: the row, and the id of the account decided and remembered before Auth hears of it. */
async function claim({ studentId, provisioningId }: ProvisionInput): Promise<Claim> {
  const admin = adminDb();
  const row = (await getStudentAccounts(admin, [studentId])).find((item) => item.studentId === studentId);
  // A missing, mismatched or deleted row stops here, before any call to Auth.
  if (row === undefined || row.provisioningId !== provisioningId || !PROVISIONABLE.has(row.status)) return { outcome: "failed" };
  if (row.authUserId !== null) return { authUserId: row.authUserId };
  // If another process remembered an id first, the RPC gives that one back, never ours.
  const remembered = await rememberStudentAccount(admin, provisioningId, randomUUID());
  return remembered.ok ? { authUserId: remembered.authUserId } : { outcome: "failed" };
}

async function provision(input: ProvisionInput): Promise<Provisioned> {
  const claimed = await claim(input);
  if ("outcome" in claimed) return claimed.outcome;
  const { authUserId } = claimed;

  const account = await ensureAuthAccount(authUserId, input.provisioningId);
  if (account !== "ok") return settle(account, input.provisioningId);

  // The person of the platform and the link with the student. Both are safe to repeat.
  const admin = adminDb();
  await upsertAppUser(admin, authUserId);
  return link(input, authUserId);
}

type Account = "ok" | "mismatch" | "rejected" | "uncertain";

/** First ask, then create (F2C-49): an answer that is neither «it exists» nor «it does not exist» creates nothing. */
async function ensureAuthAccount(authUserId: string, provisioningId: string): Promise<Account> {
  const existing = await getAuthUser(authUserId);
  if (existing !== null) return isOurs(existing, provisioningId) ? "ok" : "mismatch";
  return createAccount(authUserId, provisioningId);
}

/**
 * createUser with no password. If it fails without saying why (or says the id exists), another provisioning of the row may have won the race: it is read again and
 * must be ours, so two at once end in one account. An answer about what we sent (a 4xx) is a refusal; anything else is uncertain.
 */
async function createAccount(authUserId: string, provisioningId: string): Promise<Account> {
  try {
    await createAuthUser({ id: authUserId, email: studentEmail(authUserId), appMetadata: { provisioning_id: provisioningId } });
    return "ok";
  } catch (thrown) {
    if (!(thrown instanceof AuthAdminError)) throw thrown;
    if (thrown.kind === "invalid") return "rejected";
    // Two creations of the same id at once: GoTrue answers the loser «exists» or, when it trips on the key, a 500 that looks like an
    // outage. Either way the answer is to ask again: if the account is there and is ours, the other one won.
    const winner = await getAuthUser(authUserId);
    if (winner === null) return "uncertain";
    return isOurs(winner, provisioningId) ? "ok" : "mismatch";
  }
}

/** What each way of not getting the account means for the row: a mismatch or a refusal is marked, an uncertain answer is not. */
async function settle(account: Exclude<Account, "ok">, provisioningId: string): Promise<Provisioned> {
  if (account === "uncertain") return "uncertain";
  await failStudentAccount(adminDb(), provisioningId, account === "mismatch" ? "account_mismatch" : "auth_rejected");
  return "failed";
}

async function link({ studentId, provisioningId }: ProvisionInput, authUserId: string): Promise<Provisioned> {
  try {
    await linkStudentUser(adminDb(), studentId, authUserId);
    return "active";
  } catch (thrown) {
    if (!(thrown instanceof AppError)) throw thrown;
    // NOT_FOUND: the row went to `deleted` in the meantime, nothing to mark. Anything else: this account cannot be his.
    if (thrown.code !== "NOT_FOUND") await failStudentAccount(adminDb(), provisioningId, "link_refused");
    return "failed";
  }
}

/**
 * Provisions the students of a group that have no account yet (the ones the list already shows `active` are skipped), at most six at
 * a time. Only for ids that an RPC called with the session of the actor already authorized: the caller is issueAccessCards.
 * The answer is the outcome per student; a student that has no provisioning row (a sandbox) is `failed`.
 */
export async function provisionMissing(studentIds: readonly string[], alreadyActive: ReadonlySet<string>): Promise<Map<string, Provisioned>> {
  const missing = studentIds.filter((id) => !alreadyActive.has(id));
  const rows = missing.length === 0 ? [] : await getStudentAccounts(adminDb(), missing);
  const provisioningOf = new Map(rows.map((row) => [row.studentId, row.provisioningId]));
  const outcomes = await mapLimit(studentIds, PROVISION_LANES, async (studentId): Promise<Provisioned> => {
    if (alreadyActive.has(studentId)) return "active";
    const provisioningId = provisioningOf.get(studentId);
    return provisioningId === undefined ? "failed" : provisionStudent({ studentId, provisioningId });
  });
  return new Map(studentIds.map((id, index) => [id, outcomes[index] ?? "failed"]));
}

/**
 * internal_list_unfinished_accounts (only rows that started and did not finish, and active ones that vanished from Auth) and
 * provisionStudent for each; npm run admin:reconcile until phase 3. `failed` counts everything that is not active after this run
 * (refused or uncertain): the next run takes them up again while they have attempts left.
 */
export async function reconcile(limit: number): Promise<ReconcileSummary> {
  const rows = await listUnfinishedAccounts(adminDb(), limit);
  const outcomes = await mapLimit(rows, RECONCILE_LANES, (row) => provisionStudent({ studentId: row.studentId, provisioningId: row.provisioningId }));
  const done = outcomes.filter((outcome) => outcome === "active").length;
  return { done, failed: outcomes.length - done };
}
