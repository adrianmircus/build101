// «Podés volver a intentar a las 15:40»: the moment comes from the server (Failure.retryAt), the minutes left from `at`.

export type RetryInfo = { clock: string; minutes: number; iso: string };

export function describeRetry(retryAt: string | undefined, at: number, timeZone?: string): RetryInfo | null {
  if (!retryAt) return null;
  const moment = new Date(retryAt);
  if (Number.isNaN(moment.getTime())) return null;
  const clock = new Intl.DateTimeFormat("es-UY", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(moment);
  const minutes = Math.max(1, Math.ceil((moment.getTime() - at) / 60_000));
  return { clock, minutes, iso: moment.toISOString() };
}
