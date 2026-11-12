const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The QR of a card holds https://<origin>/t#<token>. Anything else (a link, a text) is not a card of Tiza. */
export function tokenFromScan(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/\/t\/?$/.test(url.pathname)) return null;
    const token = url.hash.slice(1);
    return TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}
