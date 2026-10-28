import type { GenerationRequest } from "@/lib/contract";
import type { Version, VersionEvent } from "./types";

// The version's history with one more event at the end. It never rewrites what's already there.
export function withEvent(version: Version, event: VersionEvent): VersionEvent[] {
  return [...(version.history ?? []), event];
}

// If the last thing the teacher did was reject the version, the next generation tells the AI why
// and what was rejected. Retrying after an error keeps it: the rejection is still the last event.
export function pendingRetry(version: Version): GenerationRequest["retry"] {
  const last = version.history?.at(-1);
  if (last?.type !== "rejected") return undefined;
  return { reasons: last.reasons, previous: version.content ?? "" };
}
