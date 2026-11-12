import "server-only";
import type { Accepted, InvitationPublic, InvitationResent, InviteRowResult } from "@/lib/domain/accounts/results";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import { unavailable } from "../unavailable";

// Invitations of staff (T2.3). The token is 32 random bytes in base64url; the database keeps only its sha256. It travels
// in the fragment of the URL and in the body of a Server Action; it is never logged or put in an error.

export type InviteStaff = { institutionId: string; emails: string[]; role: InvitedRole; opKey: string; origin: string };
export type ResendInvitation = { institutionId: string; invitationId: string; revision: number; origin: string };
export type RevokeInvitation = { institutionId: string; invitationId: string; revision: number };
export type AcceptAsNewUser = { token: string; displayName: string; password: string; ip: string };

/** Several emails at once, one result per email in the same order; one failing does not stop the rest. */
export async function inviteStaff(input: InviteStaff): Promise<InviteRowResult[]> {
  return unavailable(input);
}

export async function resendInvitation(input: ResendInvitation): Promise<InvitationResent> {
  return unavailable(input);
}

export async function revokeInvitation(input: RevokeInvitation): Promise<{ id: string }> {
  return unavailable(input);
}

/** For the page, with or without session: says how the session relates to the invitation (none, same, other). Counts against `token_ip`. */
export async function readInvitation(input: { token: string; ip: string }): Promise<InvitationPublic> {
  return unavailable(input);
}

/** Accepts with the session of whoever is signed in; their current, confirmed email has to be the invited one. */
export async function acceptInvitation(input: { token: string }): Promise<Accepted> {
  return unavailable(input);
}

/** Creates or reuses the Auth account of this invitation, finishes the signup in one transaction, then signs in. */
export async function acceptInvitationAsNewUser(input: AcceptAsNewUser): Promise<Accepted> {
  return unavailable(input);
}
