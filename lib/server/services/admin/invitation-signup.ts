import "server-only";
import { randomUUID } from "node:crypto";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import type { RpcResult } from "@/lib/domain/rpc";
import { AppError } from "@/lib/errors";
import { log } from "../../log";
import { createAsOperator, finishSignup, getInvitation } from "../../repos/admin/invitations";
import { AuthAdminError, createAuthUser } from "../../repos/admin/auth-users";
import { adminDb } from "../../repos/admin/db";

// The signup by invitation with the admin client (T2.3): the token is the credential. Never changes the password of an
// account that already exists: createUser fails when the email is taken, and the page sends that person to «Ya tenés cuenta».
// Uses repos/admin/invitations.ts and repos/admin/auth-users.ts. Nothing here logs a token, an email or a password.

export type InvitationRecord = RpcResult<"internal_get_invitation">;
export type InvitedAccount = { tokenHash: string; invitationId: string; email: string; password: string; displayName: string };

const HAS_ACCOUNT = "Ya tenés una cuenta con ese correo. Entrá con tu contraseña para aceptar la invitación.";
const WEAK_PASSWORD = "La contraseña no sirve: elegí otra de 10 caracteres como mínimo.";
const BUSY = "Hubo muchos pedidos seguidos. Probá de nuevo en un minuto.";
const OUTAGE = "No pudimos crear tu cuenta ahora. No es por vos: probá de nuevo en un rato.";

/**
 * Two signups at once for the same email: Auth lets one win and answers the other a 500 (the unique index of the email), which
 * looks like an outage. So when Auth fails without saying why, the invitation is read again: if an account with that email
 * exists now, the other signup won and this person is told the same as anyone who already has an account.
 */
async function aWinnerExists(tokenHash: string): Promise<boolean> {
  try {
    return (await readInvitationByToken(tokenHash)).hasAccount;
  } catch {
    return false;
  }
}

/** What the person is told for each way Auth can refuse the creation of the account. */
async function refuse(error: unknown, tokenHash: string): Promise<never> {
  if (!(error instanceof AuthAdminError)) throw error;
  log.warn("invitation.account_refused", { outcome: error.kind });
  if (error.kind === "exists" || (error.kind === "unavailable" && (await aWinnerExists(tokenHash)))) throw new AppError("CONFLICT", HAS_ACCOUNT);
  if (error.kind === "weak_password") throw new AppError("INVALID", WEAK_PASSWORD);
  throw new AppError("UNAVAILABLE", error.kind === "rate_limited" ? BUSY : OUTAGE);
}

/** internal_get_invitation: the invitation of a token hash (NOT_FOUND if there is none), with `hasAccount`. */
export async function readInvitationByToken(tokenHash: string): Promise<InvitationRecord> {
  return getInvitation(adminDb(), tokenHash);
}

/**
 * auth.admin.createUser with a random id, email_confirm, app_metadata.invitation_id and the display name; returns the user id.
 * The email is the one of the invitation, so nobody gets an account for an email they do not hold the invitation for.
 */
export async function createInvitedAccount(input: InvitedAccount): Promise<{ userId: string }> {
  try {
    const user = await createAuthUser({
      id: randomUUID(),
      email: input.email,
      password: input.password,
      appMetadata: { invitation_id: input.invitationId },
      userMetadata: { display_name: input.displayName },
    });
    return { userId: user.id };
  } catch (error) {
    return refuse(error, input.tokenHash);
  }
}

/** internal_finish_invitation_signup: app_user, membership and acceptance in one transaction. */
export async function finishInvitationSignup(input: { tokenHash: string; userId: string; displayName: string }): Promise<{ institutionId: string; role: InvitedRole }> {
  return finishSignup(adminDb(), input);
}

/** internal_create_invitation for the admin command (T2.2): no actor, invited_by stays NULL. */
export async function createInvitationAsOperator(input: { institutionId: string; email: string; role: InvitedRole; tokenHash: string }): Promise<{ id: string; expiresAt: string; revision: number }> {
  return createAsOperator(adminDb(), input);
}
