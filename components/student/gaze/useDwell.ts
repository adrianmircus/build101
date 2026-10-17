"use client";

import { useEffect, useRef, useState } from "react";

// Choosing by looking: holding the gaze on the same target for `ms` selects it.
// Gaps under GAP_MS (a blink, a noisy frame) don't reset the count.
const GAP_MS = 300;

export function useDwell(target: number | null, onSelect: (target: number) => void, ms = 1500) {
  const [state, setState] = useState<{ target: number | null; progress: number }>({ target: null, progress: 0 });
  const latest = useRef(target);
  const select = useRef(onSelect);

  useEffect(() => {
    latest.current = target;
    select.current = onSelect;
  });

  useEffect(() => {
    let current: number | null = null;
    let since = 0;
    let lastSeen = 0;
    // After a selection the eyes are still on the same spot: that target stays locked until they look elsewhere,
    // so the next screen doesn't get selected by accident. The same goes for whatever is being looked at on mount.
    let locked: number | null = latest.current;
    let frame = 0;

    const loop = (now: number) => {
      const seen = latest.current;
      if (seen !== null && seen === locked) {
        lastSeen = now;
      } else if (seen !== null) {
        locked = null;
        if (seen !== current) {
          current = seen;
          since = now;
        }
        lastSeen = now;
      } else if (now - lastSeen > GAP_MS) {
        current = null;
        locked = null;
      }

      const progress = current === null ? 0 : Math.min(1, (now - since) / ms);
      setState((s) => (s.target === current && s.progress === progress ? s : { target: current, progress }));
      if (current !== null && progress >= 1) {
        locked = current;
        current = null;
        select.current(locked);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [ms]);

  return state;
}
