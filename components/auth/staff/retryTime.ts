// When trying again makes sense, in the reader's local time: «a las 10:42», or with the day when it is not today.

type Options = { now?: Date; timeZone?: string };

export function formatRetryTime(retryAt: string | undefined, { now = new Date(), timeZone }: Options = {}): string | null {
  if (retryAt === undefined) return null;
  const at = new Date(retryAt);
  if (Number.isNaN(at.getTime())) return null;
  const time = new Intl.DateTimeFormat("es-UY", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at);
  const day = (date: Date) => new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeZone }).format(date);
  if (day(at) === day(now)) return `a las ${time}`;
  const label = new Intl.DateTimeFormat("es-UY", { weekday: "long", day: "numeric", month: "long", timeZone }).format(at);
  return `el ${label.replace(",", "")} a las ${time}`;
}

/** «el martes 18 de noviembre», for the expiry of an invitation. */
export function formatDay(iso: string, timeZone?: string): string {
  const label = new Intl.DateTimeFormat("es-UY", { weekday: "long", day: "numeric", month: "long", timeZone }).format(new Date(iso));
  return label.replace(",", "");
}
