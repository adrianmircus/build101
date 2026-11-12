import "server-only";
import { isSyntheticEmail, normalizeEmail } from "@/lib/domain/accounts/email";
import type { Accepted, InvitationPublic, InvitationResent, InviteOutcome, InviteRowResult } from "@/lib/domain/accounts/results";
import { messageFor } from "@/lib/domain/errors/reasons";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import { AppError } from "@/lib/errors";
import { deriveOpKey, hashToken, newToken } from "../auth/tokens";
import { log } from "../log";
import { getMailSender, invitationMail } from "../mail";
import { getClaims, signInWithPassword } from "../repos/auth-session";
import { sessionDb } from "../repos/db";
import * as rows from "../repos/invitations";
import type { RpcDb } from "../repos/rpc";
import { createInvitedAccount, finishInvitationSignup, readInvitationByToken, type InvitationRecord } from "./admin/invitation-signup";
import { guardAttempt } from "./rate-limit";

// Invitations of staff (T2.3). The token is 32 random bytes in base64url; the database keeps only its sha256. It travels
// in the fragment of the URL and in the body of a Server Action; it is never logged or put in an error.

export type InviteStaff = { institutionId: string; emails: string[]; role: InvitedRole; opKey: string; origin: string };
export type ResendInvitation = { institutionId: string; invitationId: string; revision: number; origin: string };
export type RevokeInvitation = { institutionId: string; invitationId: string; revision: number };
export type AcceptAsNewUser = { token: string; displayName: string; password: string; ip: string };

const STAFF_HOME = "/grupos";
const CLOSED = () => new AppError("INVALID", messageFor("INVALID", "invitation_closed"));
const EXPIRED = () => new AppError("INVALID", messageFor("INVALID", "invitation_expired"));
const HAS_ACCOUNT = "Ya tenés una cuenta con ese correo. Entrá con tu contraseña para aceptar la invitación.";
const ACCOUNT_READY = "Tu cuenta ya está creada. Entrá con tu correo y tu contraseña.";

/** What was made of one token: enough to put the link in the mail and to mark that very revision as sent. */
type Delivery = { token: string; invitationId: string; revision: number; expiresAt: string; origin: string };

/**
 * Sends the mail of one invitation and marks it as sent. False when the mail did not go out (the invitation exists and can be
 * resent). The name of the institution, the inviter, the address and the role are read back by the token hash, so the mail says
 * exactly what the invitation says.
 */
async function sendMail(db: RpcDb, delivery: Delivery): Promise<boolean> {
  try {
    const record = await readInvitationByToken(hashToken(delivery.token));
    await getMailSender().send(
      invitationMail({
        to: record.email,
        institutionName: record.institutionName,
        inviterName: record.inviterName,
        role: record.role,
        link: `${delivery.origin}/invitacion#${delivery.token}`,
        expiresAt: delivery.expiresAt,
      }),
    );
  } catch (error) {
    log.warn("invitation.mail_not_sent", { errorType: error instanceof Error ? error.name : typeof error });
    return false;
  }
  await markSent(db, delivery);
  return true;
}

/** A revision that moved (somebody resent meanwhile) is not an error: that mail carried an old token and the other resend sends its own. */
async function markSent(db: RpcDb, delivery: Delivery): Promise<void> {
  try {
    await rows.markInvitationSent(db, delivery.invitationId, delivery.revision);
  } catch (error) {
    if (!(error instanceof AppError && error.code === "CONFLICT")) log.warn("invitation.mark_sent_failed", { errorType: "mark" });
  }
}

// The outcomes the RPC says with a reason: the text of the error is the one of that reason, so it is compared by text.
const REASON_OUTCOMES: { code: AppError["code"]; reason: string; outcome: InviteOutcome }[] = [
  { code: "INVALID", reason: "already_member", outcome: "already_member" },
  { code: "INVALID", reason: "invalid_email", outcome: "invalid_email" },
  { code: "CONFLICT", reason: "invitation_pending", outcome: "invitation_pending" },
];

function outcomeOf(error: unknown): InviteOutcome | null {
  if (!(error instanceof AppError)) return null;
  const found = REASON_OUTCOMES.find((item) => item.code === error.code && messageFor(item.code, item.reason) === error.message);
  return found?.outcome ?? null;
}

type Created = Awaited<ReturnType<typeof rows.createInvitation>>;

/** A repeated request whose mail never went out: the token that was lost is replaced by a new one, which is the one that goes out. */
async function rotate(db: RpcDb, created: Created, origin: string): Promise<Delivery> {
  const token = newToken();
  const resent = await rows.resendInvitation(db, { invitationId: created.id, revision: created.revision, tokenHash: hashToken(token) });
  return { token, invitationId: resent.id, revision: resent.revision, expiresAt: resent.expiresAt, origin };
}

async function inviteOne(db: RpcDb, request: InviteStaff, email: string): Promise<InviteRowResult> {
  const token = newToken();
  const opKey = deriveOpKey(request.opKey, `${email}|${request.role}`);
  let created: Created;
  try {
    created = await rows.createInvitation(db, { institutionId: request.institutionId, email, role: request.role, tokenHash: hashToken(token), opKey });
  } catch (error) {
    const outcome = outcomeOf(error);
    if (outcome === null) throw error;
    return { email, outcome, invitationId: null, expiresAt: null };
  }
  const base = { email, invitationId: created.id, expiresAt: created.expiresAt };
  if (created.replayed && created.sentAt !== null) return { ...base, outcome: "sent" };
  const delivery = created.replayed
    ? await rotate(db, created, request.origin)
    : { token, invitationId: created.id, revision: created.revision, expiresAt: created.expiresAt, origin: request.origin };
  return { ...base, expiresAt: delivery.expiresAt, outcome: (await sendMail(db, delivery)) ? "sent" : "mail_failed" };
}

/** Several emails at once, one result per email in the same order; one failing does not stop the rest. */
export async function inviteStaff(input: InviteStaff): Promise<InviteRowResult[]> {
  const db = await sessionDb();
  const results: InviteRowResult[] = [];
  for (const email of input.emails) results.push(await inviteOne(db, input, normalizeEmail(email)));
  return results;
}

export async function resendInvitation(input: ResendInvitation): Promise<InvitationResent> {
  const db = await sessionDb();
  const token = newToken();
  const resent = await rows.resendInvitation(db, { invitationId: input.invitationId, revision: input.revision, tokenHash: hashToken(token) });
  const mailSent = await sendMail(db, { token, invitationId: resent.id, revision: resent.revision, expiresAt: resent.expiresAt, origin: input.origin });
  return { id: resent.id, expiresAt: resent.expiresAt, revision: resent.revision, mailSent };
}

export async function revokeInvitation(input: RevokeInvitation): Promise<{ id: string }> {
  return rows.revokeInvitation(await sessionDb(), input.invitationId, input.revision);
}

/** Whose session is looking at the invitation: nobody's, the invited email's, or somebody else's. Only a hint for the screen: the RPC decides. */
async function relationOf(record: InvitationRecord): Promise<InvitationPublic["relation"]> {
  const claims = await getClaims();
  if (claims === null) return "none";
  return claims.email !== null && normalizeEmail(claims.email) === record.email ? "same" : "other";
}

/** For the page, with or without session: says how the session relates to the invitation (none, same, other). Counts against `token_ip`. */
export async function readInvitation(input: { token: string; ip: string }): Promise<InvitationPublic> {
  await guardAttempt("token", input.ip, null);
  const record = await readInvitationByToken(hashToken(input.token));
  return {
    institutionName: record.institutionName,
    role: record.role,
    email: record.email,
    inviterName: record.inviterName,
    status: record.status,
    expiresAt: record.expiresAt,
    hasAccount: record.hasAccount,
    relation: await relationOf(record),
  };
}

/** Accepts with the session of whoever is signed in; their current, confirmed email has to be the invited one. */
export async function acceptInvitation(input: { token: string }): Promise<Accepted> {
  const { institutionId, role } = await rows.acceptInvitation(await sessionDb(), hashToken(input.token));
  return { institutionId, role, next: STAFF_HOME };
}

/** The checks before an account is made: the invitation is open and nobody has an account with its email. */
function assertOpenWithoutAccount(record: InvitationRecord): void {
  if (record.status === "accepted" || record.status === "revoked") throw CLOSED();
  if (record.status === "expired") throw EXPIRED();
  if (record.hasAccount || isSyntheticEmail(record.email)) throw new AppError("CONFLICT", HAS_ACCOUNT);
}

/** Creates or reuses the Auth account of this invitation, finishes the signup in one transaction, then signs in. */
export async function acceptInvitationAsNewUser(input: AcceptAsNewUser): Promise<Accepted> {
  await guardAttempt("token", input.ip, null);
  const tokenHash = hashToken(input.token);
  const record = await readInvitationByToken(tokenHash);
  assertOpenWithoutAccount(record);
  const displayName = input.displayName.trim();
  const { userId } = await createInvitedAccount({ tokenHash, invitationId: record.id, email: record.email, password: input.password, displayName });
  const { institutionId, role } = await finishInvitationSignup({ tokenHash, userId, displayName });
  const claims = await signInWithPassword(record.email, input.password).catch(() => null);
  if (claims === null) throw new AppError("UNAVAILABLE", ACCOUNT_READY);
  return { institutionId, role, next: STAFF_HOME };
}
