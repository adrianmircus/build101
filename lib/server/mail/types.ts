import "server-only";
import type { InvitedRole } from "@/lib/domain/identity/entities";

/** The environment the drivers read: process.env, or a plain object in a test. */
export type MailEnv = Readonly<Record<string, string | undefined>>;

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
  /** `${origin}/invitacion#${token}`: the token travels in the fragment, which the browser never sends to a server. */
  link: string;
  expiresAt: string;
};
