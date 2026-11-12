import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Mail, invitationToken, latestMailTo } from "../../integration/support/mailbox";

// The mail of the run, read from Mailpit (the catcher of the local Supabase). Every test writes to an address of its own.

export { invitationToken, latestMailTo, type Mail };

/** The `site_url` of Supabase Auth (supabase/config.toml): the origin every link of its mails starts with. */
export function authSiteUrl(): URL {
  const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");
  const value = /^site_url\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (value === undefined) throw new Error("supabase/config.toml no tiene site_url.");
  return new URL(value);
}

/** The link of a recovery mail, exactly as it arrived (the first address that ends in `/ingresar/profesor/nueva#<token>`). */
export function recoveryLink(mail: Mail): URL {
  const found = /https?:\/\/[^\s"'<>]*\/ingresar\/profesor\/nueva#[A-Za-z0-9_-]+/.exec(mail.text)?.[0];
  if (found === undefined) throw new Error("El correo de recuperación no trae el enlace.");
  return new URL(found);
}

/** A mail for this address must have arrived (Mailpit, up to 5 seconds). */
export async function waitForMail(address: string): Promise<Mail> {
  const mail = await latestMailTo(address);
  if (mail === null) throw new Error("No llegó el correo a Mailpit.");
  return mail;
}
