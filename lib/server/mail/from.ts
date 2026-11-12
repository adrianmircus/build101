import "server-only";
import type { MailEnv } from "./types";

// The sender of every mail: MAIL_FROM as `Tiza <no-responder@usetiza.app>` or a bare address.
const DEFAULT_FROM = "Tiza <no-responder@usetiza.app>";
const NAMED = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/;

export type Sender = { name: string; email: string; header: string };

/** MAIL_FROM, or the default. A value that is not an address is an error of configuration, not something to send with. */
export function readSender(env: MailEnv = process.env): Sender {
  const raw = (env.MAIL_FROM ?? "").trim() || DEFAULT_FROM;
  const named = NAMED.exec(raw);
  if (named?.[2] !== undefined) return { name: (named[1] ?? "").replace(/^"|"$/g, ""), email: named[2], header: raw };
  if (/^[^<>\s]+@[^<>\s]+$/.test(raw)) return { name: "", email: raw, header: raw };
  throw new Error("MAIL_FROM no es una dirección válida. Mirá .env.example.");
}
