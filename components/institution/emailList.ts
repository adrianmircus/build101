import { normalizeEmail } from "@/lib/domain/accounts/email";

// Turns what the admin pasted (one per line, or with commas, semicolons or spaces) into a list of emails, and says
// why one does not look like an email. Pure: the screen and the tests use the same functions.

/** What a single invitation request accepts (InviteStaffInput). */
export const MAX_EMAILS = 50;

export type Malformed = "missing_at" | "missing_domain_end" | "other";

/** The pieces of a pasted list, in order and with the signs of a contact list («<a@b.uy>», quotes) taken off. */
export function splitEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((piece) => piece.replace(/^[<"'(]+|[>"')]+$/g, ""))
    .filter((piece) => piece.length > 0)
    .map(normalizeEmail);
}

/** null when it looks like an email; otherwise the reason it does not (so the screen can say what is missing). */
export function malformedReason(email: string): Malformed | null {
  const parts = email.split("@");
  if (parts.length < 2) return "missing_at";
  const [local, domain, ...rest] = parts;
  if (rest.length > 0 || !local || !domain) return "other";
  const labels = domain.split(".");
  const last = labels[labels.length - 1] ?? "";
  if (labels.length < 2 || last.length < 2) return "missing_domain_end";
  if (labels.some((label) => !/^[a-z0-9-]+$/.test(label))) return "other";
  return null;
}
