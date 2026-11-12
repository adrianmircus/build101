import type { InvitationPublic } from "@/lib/domain/accounts/results";
import type { InvitedRole } from "@/lib/domain/identity/entities";

// The words of the invitation screens, in Rioplatense Spanish.

const ROLE_LABEL: Record<InvitedRole, string> = {
  admin: "admin",
  teacher: "profe",
  inclusion: "parte del equipo de inclusión",
};

export function roleLabel(role: InvitedRole): string {
  return ROLE_LABEL[role];
}

/** «Marta Rodríguez te invitó a sumarte a Colegio San José», or without the name when the inviter has none. */
export function inviteTitle(invitation: Pick<InvitationPublic, "inviterName" | "institutionName">): string {
  const who = invitation.inviterName ? `${invitation.inviterName} te invitó` : "Te invitaron";
  return `${who} a sumarte a ${invitation.institutionName}`;
}
