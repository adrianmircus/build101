"use client";

import { useEffect, useRef } from "react";

/** The id of the «Revocar» button of an invitation row: where the focus returns when the question is cancelled. */
export const revokeButtonId = (invitationId: string) => `revocar-${invitationId}`;

/**
 * Cancelling a question unmounts the button that has the focus, and the browser leaves it on the page. The returned function says
 * «give it back»: when `phase` is idle again (the trigger is mounted), the focus goes to the element with `targetId`.
 */
export function useReturnFocus(phase: string, targetId: string): () => void {
  const pending = useRef(false);
  useEffect(() => {
    if (phase !== "idle" || !pending.current) return;
    pending.current = false;
    document.getElementById(targetId)?.focus();
  }, [phase, targetId]);
  return () => {
    pending.current = true;
  };
}
