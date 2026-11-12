import "server-only";
import { readSender } from "./from";
import type { MailEnv } from "./types";

// The ONE rule for the mail configuration (F2-10). The startup check (lib/server/startup-config.ts) and the choice of the
// sender (./index.ts) both read it, so a server that starts can never refuse to send because of its configuration.
// The messages name variables, never their values.

export const MAIL_DRIVERS = ["resend", "mailpit"] as const;
export type MailDriver = (typeof MAIL_DRIVERS)[number];

export const MAILPIT_DEFAULT_URL = "http://127.0.0.1:54324";

const filled = (value: string | undefined): boolean => (value ?? "").trim() !== "";

/** Resend in production, Mailpit anywhere else, unless MAIL_DRIVER says otherwise. May be a name that is not a driver. */
export function requestedDriver(env: MailEnv): string {
  return (env.MAIL_DRIVER ?? "").trim() || (env.NODE_ENV === "production" ? "resend" : "mailpit");
}

export function mailpitUrl(env: MailEnv): string {
  return (env.MAIL_MAILPIT_URL ?? "").trim() || MAILPIT_DEFAULT_URL;
}

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isMailDriver(value: string): value is MailDriver {
  return MAIL_DRIVERS.some((driver) => driver === value);
}

function resendProblems(env: MailEnv): string[] {
  const problems: string[] = [];
  if (!filled(env.RESEND_API_KEY)) problems.push("RESEND_API_KEY (la clave de Resend)");
  if (!filled(env.MAIL_FROM)) problems.push("MAIL_FROM (el remitente de los correos)");
  return problems;
}

function mailpitProblems(env: MailEnv): string[] {
  const url = mailpitUrl(env);
  if (env.NODE_ENV === "production" && !isLocalUrl(url)) {
    return ["MAIL_MAILPIT_URL (en producción Mailpit solo se acepta en localhost o 127.0.0.1; para correo real usá MAIL_DRIVER=resend)"];
  }
  return URL.canParse(url) ? [] : ["MAIL_MAILPIT_URL (tiene que ser una dirección)"];
}

function senderProblems(env: MailEnv): string[] {
  if (!filled(env.MAIL_FROM)) return [];
  try {
    readSender(env);
    return [];
  } catch {
    return ["MAIL_FROM (tiene que ser una dirección, como Tiza <hola@tu-dominio.uy>)"];
  }
}

/**
 * What is wrong with the mail configuration, one line per variable (empty when it is complete).
 * - an unknown MAIL_DRIVER is a problem;
 * - `resend` needs RESEND_API_KEY and MAIL_FROM (an address the sender can read);
 * - `mailpit` in production is accepted only when MAIL_MAILPIT_URL is local (the e2e runs the production build against it);
 *   outside production any address is accepted.
 */
export function mailProblems(env: MailEnv): string[] {
  const driver = requestedDriver(env);
  if (!isMailDriver(driver)) return ["MAIL_DRIVER (tiene que ser resend o mailpit)"];
  const own = driver === "resend" ? resendProblems(env) : mailpitProblems(env);
  return [...own, ...senderProblems(env)];
}
