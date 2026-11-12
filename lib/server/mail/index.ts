import "server-only";
import { mailpitSender } from "./mailpit";
import { resendSender } from "./resend";
import type { MailEnv, MailSender } from "./types";

// Mail of phase 2 (T2.3). Two drivers chosen by MAIL_DRIVER: Resend (fetch to its API; RESEND_API_KEY and MAIL_FROM) and
// Mailpit for development and tests (POST /api/v1/send on port 54324). No log carries a recipient, a link or a token.
// Password recovery is sent by Supabase Auth, not by this.

export type { InvitationMailInput, MailMessage, MailSender } from "./types";
export { invitationMail } from "./invitation";

const MISSING = "Falta la configuración del correo: hace falta RESEND_API_KEY y MAIL_FROM. Mirá .env.example.";

/** Resend in production, Mailpit anywhere else, unless MAIL_DRIVER says otherwise. */
function driverOf(env: MailEnv): string {
  return (env.MAIL_DRIVER ?? "").trim() || (env.NODE_ENV === "production" ? "resend" : "mailpit");
}

/**
 * The sender for this environment, chosen by MAIL_DRIVER (`resend` or `mailpit`). In production, without RESEND_API_KEY it is an
 * error of configuration: the app must not run thinking that it sends mail.
 */
export function getMailSender(env: MailEnv = process.env): MailSender {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (env.NODE_ENV === "production" && apiKey === "") throw new Error(MISSING);
  const driver = driverOf(env);
  if (driver === "mailpit") return mailpitSender(env);
  if (driver === "resend" && apiKey !== "") return resendSender(apiKey, env);
  throw new Error(MISSING);
}
