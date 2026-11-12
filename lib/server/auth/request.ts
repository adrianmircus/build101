import "server-only";
import { unavailable } from "../unavailable";

/**
 * The IP of the client (T2.7): `x-nf-client-connection-ip` (Netlify), else the first value of `x-forwarded-for`, else
 * "unknown". A Server Action reads it with clientIp(await headers()) and passes it to the service.
 */
export function clientIp(source: Pick<Headers, "get">): string {
  return unavailable(source);
}
