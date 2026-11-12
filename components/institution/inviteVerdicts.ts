import { isSyntheticEmail } from "@/lib/domain/accounts/email";
import type { InvitationView, StaffRow } from "@/lib/domain/accounts/entities";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import { malformedReason, splitEmails, type Malformed } from "./emailList";

// The «revisar» step of inviting staff: for each pasted email, whether it goes out or why it does not. The server
// checks again (create_invitation); this is what the admin sees before confirming, so nothing surprises them later.

export type Verdict =
  | { kind: "send" }
  | { kind: "malformed"; why: Malformed }
  | { kind: "synthetic" }
  | { kind: "repeated" }
  | { kind: "member" }
  | { kind: "pending" };

export type ReviewRow = { email: string; verdict: Verdict };

export type ReviewContext = {
  role: InvitedRole;
  members: Pick<StaffRow, "email" | "roles">[];
  invitations: Pick<InvitationView, "email" | "role" | "status">[];
};

export function reviewInvites(text: string, context: ReviewContext): ReviewRow[] {
  const seen = new Set<string>();
  return splitEmails(text).map((email) => ({ email, verdict: verdictFor(email, seen, context) }));
}

function verdictFor(email: string, seen: Set<string>, { role, members, invitations }: ReviewContext): Verdict {
  const why = malformedReason(email);
  if (why) return { kind: "malformed", why };
  if (isSyntheticEmail(email)) return { kind: "synthetic" };
  if (seen.has(email)) return { kind: "repeated" };
  seen.add(email);
  if (members.some((member) => member.email.toLowerCase() === email && member.roles.includes(role))) return { kind: "member" };
  if (invitations.some((item) => item.email.toLowerCase() === email && item.role === role && item.status === "pending")) return { kind: "pending" };
  return { kind: "send" };
}

export function emailsToSend(rows: ReviewRow[]): string[] {
  return rows.filter((row) => row.verdict.kind === "send").map((row) => row.email);
}

/** The reason an email is not sent, in the words the admin reads; null for the ones that go out. */
export function reasonText(verdict: Verdict): string | null {
  switch (verdict.kind) {
    case "send":
      return null;
    case "member":
      return "Ya está en el colegio con ese rol.";
    case "pending":
      return "Ya tiene una invitación esperando respuesta.";
    case "repeated":
      return "Está repetido: se manda una sola vez.";
    case "synthetic":
      return "Ese correo es de una cuenta de estudiante. Usá el correo del profe.";
    case "malformed":
      if (verdict.why === "missing_at") return "Le falta la arroba.";
      if (verdict.why === "missing_domain_end") return "Le falta el final, por ejemplo .edu.uy.";
      return "No parece un correo. Revisalo.";
  }
}

/** Only a badly written email is fixed by editing the list: those get the «Corregir» link. */
export function canFix(verdict: Verdict): boolean {
  return verdict.kind === "malformed";
}
