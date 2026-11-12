import type { CardOutcome } from "./read-card";

export type ScanView =
  | { kind: "idle" }
  | { kind: "camera" }
  | { kind: "reading" }
  | { kind: "nocamera" }
  | { kind: "problem"; why: "unusable" | "unavailable" }
  | { kind: "pause"; retryAt: string | undefined; at: number }
  | { kind: "card"; card: { code: string; name: string; username: string } };

/** What the scan screen shows once the card was read (or could not be). `at` is the moment, for the minutes of a pause. */
export function viewOfCard(outcome: CardOutcome, at: number): ScanView {
  switch (outcome.kind) {
    case "card":
      return { kind: "card", card: { code: outcome.code, name: outcome.name, username: outcome.username } };
    case "pause":
      return { kind: "pause", retryAt: outcome.retryAt, at };
    default:
      return { kind: "problem", why: outcome.kind };
  }
}
