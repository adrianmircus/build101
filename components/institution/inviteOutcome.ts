import type { InviteOutcome, InviteRowResult } from "@/lib/domain/accounts/results";

// What the server says about each email after confirming. One per email, in the same order.

const TEXT: Record<InviteOutcome, string> = {
  sent: "Invitación enviada.",
  mail_failed: "Quedó creada, pero no pudimos mandar el correo. Reenviala desde la lista de invitaciones.",
  already_member: "Ya está en el colegio con ese rol.",
  invitation_pending: "Ya tenía una invitación esperando respuesta.",
  invalid_email: "El correo no es válido.",
};

export function outcomeText(outcome: InviteOutcome): string {
  return TEXT[outcome];
}

export function countSent(results: InviteRowResult[]): number {
  return results.filter((row) => row.outcome === "sent").length;
}

export function doneTitle(results: InviteRowResult[]): string {
  const sent = countSent(results);
  if (sent === 0) return "No se mandó ninguna invitación";
  return sent === 1 ? "Mandamos 1 invitación" : `Mandamos ${sent} invitaciones`;
}

/** Whether something needs the admin's attention after this batch. */
export function hasTrouble(results: InviteRowResult[]): boolean {
  return results.some((row) => row.outcome !== "sent");
}
