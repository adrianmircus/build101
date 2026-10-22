// Where the visitor is in the demo's tour. In sessionStorage so it survives route and role changes in the tab.
import { useSyncExternalStore } from "react";

export type TourState = {
  step: number;
  // false: the visitor skipped it; the demo bar offers to pick it up again.
  open: boolean;
  finished: boolean;
};

const KEY = "tiza:tour";
const START: TourState = { step: 0, open: true, finished: false };

let cache: TourState | null = null;
const listeners = new Set<() => void>();

function read(): TourState {
  if (cache) return cache;
  try {
    const raw = sessionStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as TourState) : START;
  } catch {
    cache = START;
  }
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTour(update: Partial<TourState>) {
  cache = { ...read(), ...update };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Without sessionStorage the tour still works, it just doesn't survive a reload.
  }
  listeners.forEach((listener) => listener());
}

export function restartTour() {
  setTour(START);
}

// null on the server: the tour only exists in the browser.
export function useTour(): TourState | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
