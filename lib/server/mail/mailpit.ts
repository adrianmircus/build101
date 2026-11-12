import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "../log";
import { readSender } from "./from";
import type { MailEnv, MailMessage, MailSender } from "./types";

// Mailpit, the mail catcher of Supabase local (port 54324, the container `supabase_inbucket_*`): its HTTP API of sending,
// `POST /api/v1/send`. For development and tests only: nothing leaves the machine. MAIL_MAILPIT_URL changes the address.

const DEFAULT_URL = "http://127.0.0.1:54324";
const TIMEOUT_MS = 5_000;
const FAILED = "No pudimos mandar el correo. Probá de nuevo en un rato.";

export function mailpitSender(env: MailEnv = process.env): MailSender {
  const base = (env.MAIL_MAILPIT_URL ?? "").trim() || DEFAULT_URL;
  const sender = readSender(env);
  return {
    async send(message: MailMessage): Promise<void> {
      let response: Response;
      try {
        response = await fetch(`${base}/api/v1/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            From: { Email: sender.email, Name: sender.name },
            To: [{ Email: message.to }],
            Subject: message.subject,
            Text: message.text,
            HTML: message.html,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        log.warn("mail.failed", { provider: "mailpit", outcome: "no_answer" });
        throw new AppError("UNAVAILABLE", FAILED);
      }
      if (response.ok) return;
      log.warn("mail.failed", { provider: "mailpit", providerStatus: response.status });
      throw new AppError("UNAVAILABLE", FAILED);
    },
  };
}
