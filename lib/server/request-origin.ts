import "server-only";
import { z } from "zod";

/**
 * The public origin that goes into the links of emails and QR codes (https://host, no trailing slash). It comes from
 * configuration (NEXT_PUBLIC_SITE_URL, else the deployment URL), never from the Host or Origin headers of the
 * request: an attacker could set those and get a reset link that points at their own server.
 */
export function publicOrigin(env: Record<string, string | undefined> = process.env): string {
  // Netlify sets URL to the main address of the site; a deploy preview has its own DEPLOY_PRIME_URL.
  const raw = env.NEXT_PUBLIC_SITE_URL ?? env.URL ?? env.DEPLOY_PRIME_URL;
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(raw);
  if (!parsed.success) throw new Error("Falta NEXT_PUBLIC_SITE_URL (la dirección pública del sitio). Mirá .env.example.");
  const url = new URL(parsed.data);
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("NEXT_PUBLIC_SITE_URL tiene que ser https fuera de localhost.");
  }
  return url.origin;
}
