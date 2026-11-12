import type { InvitationView, StaffRow } from "@/lib/domain/accounts/entities";
import type { InvitedRole, MemberRole } from "@/lib/domain/identity/entities";
import { formatDay } from "@/components/auth/staff/retryTime";

// The words of the lists «Ver profes e invitaciones» and «Ver grupos». The days are written in the time of Uruguay,
// the same on the server and in the browser, so the page does not change when it loads.

const ZONE = "America/Montevideo";

const ROLE: Record<MemberRole, string> = { admin: "Admin", teacher: "Profe", inclusion: "Inclusión", student: "Estudiante" };

export function roleName(role: InvitedRole | MemberRole): string {
  return ROLE[role];
}

/** «Admin y Profe»: a person can have more than one role in the same school. */
export function rolesText(roles: MemberRole[]): string {
  return roles.map(roleName).join(" y ");
}

/** The invitations that wait for an answer: pending, and expired ones that can be sent again. The closed ones are history. */
export function waitingInvitations(items: InvitationView[]): InvitationView[] {
  return items.filter((item) => item.status === "pending" || item.status === "expired");
}

export function invitationLine(item: InvitationView): string {
  const when = formatDay(item.expiresAt, ZONE);
  const expiry = item.status === "expired" ? `venció el ${when}` : `vence el ${when}`;
  return `${roleName(item.role)} · ${expiry}`;
}

/** An invitation whose mail did not go out yet: the admin should know, it can be sent again. */
export function mailPending(item: InvitationView): boolean {
  return item.status === "pending" && item.sentAt === null;
}

export function staffLine(row: StaffRow, isYou: boolean): string {
  const entered = row.hasSignedIn ? "ya entró alguna vez" : "todavía no entró";
  return `${rolesText(row.roles)} · ${isYou ? "vos" : entered}`;
}

export function countText(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}
