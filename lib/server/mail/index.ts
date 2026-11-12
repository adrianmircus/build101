import "server-only";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import { unavailable } from "../unavailable";

// Mail of phase 2 (T2.3). Two drivers chosen by MAIL_DRIVER: Resend (fetch to its API; RESEND_API_KEY and
// MAIL_FROM) and Mailpit for development and tests (POST /api/v1/send on port 54324). No log carries a recipient,
// a link or a token. Password recovery is sent by Supabase Auth, not by this.

export type MailMessage = { to: string; subject: string; text: string; html: string };

export interface MailSender {
  /** Throws AppError UNAVAILABLE when the provider fails: the caller tells the admin the mail did not go out. */
  send(message: MailMessage): Promise<void>;
}

export type InvitationMailInput = {
  to: string;
  institutionName: string;
  inviterName: string | null;
  role: InvitedRole;
  /** `${origin}/invitacion/${token}`. */
  link: string;
  expiresAt: string;
};

/** In production without RESEND_API_KEY the app does not start. */
export function getMailSender(): MailSender {
  return unavailable();
}

export function invitationMail(input: InvitationMailInput): MailMessage {
  return unavailable(input);
}
