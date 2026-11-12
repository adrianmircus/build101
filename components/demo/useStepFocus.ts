import { useEffect, type RefObject } from "react";

const FIELDS = "input:not([type='button'], [type='submit'], [type='checkbox'], [type='radio']), textarea, select";

// A field the visitor may be typing in: moving focus away from it would cut their sentence in half.
function isTyping(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && (active.isContentEditable || active.matches(FIELDS));
}

// How many frames to keep trying: a bubble that is still being placed can be hidden for a frame, and a hidden
// element can't take focus.
const TRIES = 10;

// Moves focus to the bubble's title on each new step, so a screen reader reads it. Not when the visitor is typing
// in a field of the page, and without scrolling (the bubble is already on screen).
export function useStepFocus(title: RefObject<HTMLElement | null>, step: string) {
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const focus = () => {
      const element = title.current;
      if (!element || isTyping()) return;
      element.focus({ preventScroll: true });
      if (document.activeElement !== element && ++tries < TRIES) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [title, step]);
}
