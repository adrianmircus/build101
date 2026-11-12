import { z } from "zod";

// The mail catcher of Supabase local (Mailpit, port 54324): what a test reads to know that a mail went out and what it says.
// Every test writes to an address of its own, so tests never read each other's mail.

const BASE = process.env.MAIL_MAILPIT_URL || "http://127.0.0.1:54324";

export type Mail = { subject: string; text: string; html: string };

async function json(path: string): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(5_000) });
  return response.json();
}

const Found = z.object({ messages: z.array(z.object({ ID: z.string() })).nullable().optional() });
const Message = z.object({ Subject: z.string(), Text: z.string(), HTML: z.string() });

/** The ids of the mails to that address, newest first. */
export async function mailIdsTo(address: string): Promise<string[]> {
  const found = Found.parse(await json(`/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`));
  return (found.messages ?? []).map((message) => message.ID);
}

/** Waits for the newest mail to that address (up to 5 seconds), or null when none came. */
export async function latestMailTo(address: string, options: { after?: number } = {}): Promise<Mail | null> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const ids = await mailIdsTo(address);
    const id = ids[0];
    if (id !== undefined && ids.length > (options.after ?? 0)) {
      const message = Message.parse(await json(`/api/v1/message/${id}`));
      return { subject: message.Subject, text: message.Text, html: message.HTML };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

/** The token of the link of an invitation (`/invitacion#<token>`) in a mail. */
export function invitationToken(mail: Mail): string {
  const token = /\/invitacion#([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];
  if (token === undefined) throw new Error("El correo de la invitación no trae el enlace.");
  return token;
}
