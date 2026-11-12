import "server-only";
import { isMailDriver, mailProblems, requestedDriver } from "./config";
import { mailpitSender } from "./mailpit";
import { resendSender } from "./resend";
import type { MailEnv, MailSender } from "./types";

// Mail of phase 2 (T2.3). Two drivers chosen by MAIL_DRIVER: Resend (fetch to its API; RESEND_API_KEY and MAIL_FROM) and
// Mailpit for development and tests (POST /api/v1/send on port 54324). No log carries a recipient, a link or a token.
// Password recovery is sent by Supabase Auth, not by this.

export type { InvitationMailInput, MailMessage, MailSender } from "./types";
export { invitationMail } from "./invitation";

/**
 * The sender for this environment, chosen by MAIL_DRIVER (`resend` or `mailpit`). The rule is the one of the startup check
 * (./config.ts): if the server started, this does not fail because of the configuration.
 */
export function getMailSender(env: MailEnv = process.env): MailSender {
  const problems = mailProblems(env);
  if (problems.length > 0) throw new Error(`Falta o está mal la configuración del correo: ${problems.join("; ")}. Mirá .env.example.`);
  const driver = requestedDriver(env);
  if (!isMailDriver(driver)) throw new Error("MAIL_DRIVER tiene que ser resend o mailpit. Mirá .env.example.");
  return driver === "mailpit" ? mailpitSender(env) : resendSender((env.RESEND_API_KEY ?? "").trim(), env);
}
