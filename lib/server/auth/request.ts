import "server-only";

const MAX_IP_LENGTH = 64;
const NO_IP = "unknown";

// An IP address as text (v4, v6, with a zone): anything else is not trusted as a counter key.
const IP_SHAPE = /^[0-9a-fA-F:.]+(?:%[\w.-]+)?$/;

function usable(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  return value.length > 0 && value.length <= MAX_IP_LENGTH && IP_SHAPE.test(value) ? value.toLowerCase() : null;
}

/**
 * The IP of the client (T2.7): `x-nf-client-connection-ip` (Netlify), else the first value of `x-forwarded-for`, else
 * "unknown". A Server Action reads it with clientIp(await headers()) and passes it to the service.
 * Only the Netlify header is set by the platform: `x-forwarded-for` can be written by the client, so outside Netlify
 * (local, tests) it is a convenience and never a security boundary. That is why no counter limits by IP alone.
 */
export function clientIp(source: Pick<Headers, "get">): string {
  return usable(source.get("x-nf-client-connection-ip")) ?? usable(source.get("x-forwarded-for")?.split(",")[0]) ?? NO_IP;
}
