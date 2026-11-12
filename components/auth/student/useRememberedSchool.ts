"use client";

import { useMemo, useSyncExternalStore } from "react";
import { parseRememberedSchool, readRememberedRaw, subscribeRememberedSchool, type RememberedSchool } from "@/lib/client/remembered-school";

const unknownOnServer = () => undefined;

/** `undefined` until the browser has been asked (and on the server), then the school or `null`. */
export function useRememberedSchool(): RememberedSchool | null | undefined {
  const raw = useSyncExternalStore(subscribeRememberedSchool, readRememberedRaw, unknownOnServer);
  return useMemo(() => (raw === undefined ? undefined : parseRememberedSchool(raw)), [raw]);
}
