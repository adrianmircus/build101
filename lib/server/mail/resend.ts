import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "../log";
import { readSender } from "./from";
import type { MailEnv, MailMessage, MailSender } from "./types";

// Resend through its HTTP API (https://resend.com/docs/api-reference/emails/send-email), with no dependency. The key and the
// sender come from RESEND_API_KEY and MAIL_FROM. Nothing about the message is logged: only the status of the answer.

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;
const FAILED = "No pudimos mandar el correo. Probá de nuevo en un rato.";

export function resendSender(apiKey: string, env: MailEnv = process.env): MailSender {
  const from = readSender(env).header;
  return {
    async send(message: MailMessage): Promise<void> {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        log.warn("mail.failed", { provider: "resend", outcome: "no_answer" });
        throw new AppError("UNAVAILABLE", FAILED);
      }
      if (response.ok) return;
      log.warn("mail.failed", { provider: "resend", providerStatus: response.status });
      throw new AppError("UNAVAILABLE", FAILED);
    },
  };
}
