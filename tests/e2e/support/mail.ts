import { type Mail, invitationToken, latestMailTo } from "../../integration/support/mailbox";

// The mail of the run, read from Mailpit (the catcher of the local Supabase). Every test writes to an address of its own.

export { invitationToken, latestMailTo, type Mail };

/** The token of the link of a recovery mail (`/ingresar/profesor/nueva#<token>`). The host of the link is the one of the Supabase config, not the one under test. */
export function recoveryToken(mail: Mail): string {
  const token = /\/ingresar\/profesor\/nueva#([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
  if (token === undefined) throw new Error("El correo de recuperación no trae el enlace.");
  return token;
}

/** A mail for this address must have arrived (Mailpit, up to 5 seconds). */
export async function waitForMail(address: string): Promise<Mail> {
  const mail = await latestMailTo(address);
  if (mail === null) throw new Error("No llegó el correo a Mailpit.");
  return mail;
}
