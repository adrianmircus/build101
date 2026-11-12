"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { startScan } from "./camera-scan";

type Handlers = { onCode: (raw: string) => void; onProblem: () => void };

/** Shows the camera in `video` and reports each QR it reads. Everything stays in the browser. */
export function useCameraScan(video: RefObject<HTMLVideoElement | null>, handlers: Handlers): boolean {
  const [ready, setReady] = useState(false);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    return startScan(element, {
      onReady: () => setReady(true),
      onCode: (raw) => latest.current.onCode(raw),
      onProblem: () => latest.current.onProblem(),
    });
  }, [video]);

  return ready;
}
