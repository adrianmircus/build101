import "server-only";
import { unavailable } from "./unavailable";

/**
 * The public origin that goes into the links of emails and QR codes (https://host, no trailing slash). It comes from
 * configuration (NEXT_PUBLIC_SITE_URL, else the deployment URL), never from the Host or Origin headers of the
 * request: an attacker could set those and get a reset link that points at their own server.
 */
export function publicOrigin(): string {
  return unavailable();
}
