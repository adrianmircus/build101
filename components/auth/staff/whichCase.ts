import type { InvitationPublic } from "@/lib/domain/accounts/results";

// Which of the six cases of the maqueta invitacion-a an invitation is in. The first one that applies wins.
//   expired  : it no longer works (expired, used or cancelled)
//   other    : there is a session, and it is of another email (the mark of B)
//   accept   : there is a session of the invited email: one tap
//   signin   : no session, but the account exists: enter to accept
//   new      : no session and no account: create it
// «done» is not here: it comes from accepting, not from reading.

export type InvitationCase = "expired" | "other" | "accept" | "signin" | "new";

export function caseOf(invitation: InvitationPublic, wantsSignIn: boolean): InvitationCase {
  if (invitation.status !== "pending") return "expired";
  if (invitation.relation === "other") return "other";
  if (invitation.relation === "same") return "accept";
  return invitation.hasAccount || wantsSignIn ? "signin" : "new";
}
