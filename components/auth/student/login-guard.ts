// A card opened over another one (a second QR in the same tab) leaves the login of the first one in the air: its answer can
// still arrive and set the session of that student. This keeps track of the logins in flight so the page can say «that one is old»
// and wait until it is over (and, if it did sign in, closed) before it shows the new card. Only the browser tab has it: no storage.

export type LoginTicket = {
  /** True once a new card came: when the answer arrives it may not take the student anywhere. */
  readonly stale: boolean;
  /** The login is over (navigated, failed, or was closed as old). */
  finish: () => void;
};

type Entry = { ticket: LoginTicket & { stale: boolean }; over: Promise<void> };

const inFlight = new Set<Entry>();

// A login that did sign in but whose session could not be confirmed closed (the signOut failed). While there is one, the new card does not show.
let unclosed = 0;

/** A good login of an old card could not be closed yet: the session of that student is still usable. */
export function markUnclosed(): void {
  unclosed += 1;
}

/** The signOut was confirmed: no old session is left. */
export function markClosed(): void {
  unclosed = 0;
}

/** True while a session of an old card is not confirmed closed. */
export function hasUnclosed(): boolean {
  return unclosed > 0;
}

/** A login is about to go out. */
export function beginLogin(): LoginTicket {
  let finish!: () => void;
  const over = new Promise<void>((resolve) => (finish = resolve));
  const entry: Entry = { ticket: { stale: false, finish: () => (inFlight.delete(entry), finish()) }, over };
  inFlight.add(entry);
  return entry.ticket;
}

/** A new card arrived. Marks the logins in flight as old and answers when every one of them is over. */
export async function supersedeLogins(): Promise<void> {
  const mine = [...inFlight];
  for (const entry of mine) entry.ticket.stale = true;
  await Promise.all(mine.map((entry) => entry.over));
}
