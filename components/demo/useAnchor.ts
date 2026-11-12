"use client";

import { useEffect, useRef, useState } from "react";
import { bringIntoView, screenSize, type Box } from "./bubblePosition";

// How long to wait for an element that isn't there yet before showing the bubble without it.
const WAIT = 3000;
// How long the highlight takes to glide from the previous element to the new one.
const GLIDE = 250;
// If the scroll never reports its end (browsers without scrollend), the step shows anyway after this.
const SCROLL_LIMIT = 900;
// Longest the tour waits for the page's own transition before showing anyway.
const TRANSITION_LIMIT = 1500;
// Longest the tour waits for the element to stand still once it's on the screen. An element that keeps moving
// (a layout that never stops changing, a slow device catching up) gets its bubble anyway, which then follows it.
const SETTLE_LIMIT = 3000;

export type AnchorState = {
  anchor?: string;
  pathname?: string;
  box: Box | null;
  // The element stopped moving (the scroll that brings it into view ended): only then the bubble shows.
  settled: boolean;
  // The highlight is gliding from the previous element: the bubble waits for it.
  gliding: boolean;
  // Until it settles, the highlight stays where the previous step left it.
  held: Box | null;
  missing: boolean;
  vw: number;
  vh: number;
};

// What the loop remembers between frames for one step.
type Tracker = {
  start: number;
  from: Box | null;
  seenAt: number;
  scrolling: boolean;
  scrollStart: number;
  previous: Box | null;
  still: number;
  settledAt: number;
};

const same = (a: Box | null, b: Box | null) =>
  !!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

// A point in the middle of the element: on a new page the highlight opens from there.
const collapsed = (box: Box): Box => ({ top: box.top + box.height / 2, left: box.left + box.width / 2, width: 0, height: 0 });

// The page's own view transition (the content sliding between pages) is still playing. Only running or pending
// ones count: a finished animation can stay in getAnimations() (fill mode) and used to hold the tour forever.
const pageMoving = () =>
  document.getAnimations().some((a) => {
    if (a.playState !== "running" && !a.pending) return false;
    const target = (a.effect as KeyframeEffect | null)?.pseudoElement ?? "";
    return target.startsWith("::view-transition") && !target.includes("demo-");
  });

// The element's box on the screen, or null while it isn't there or has no size.
function boxOf(anchor: string): { r: DOMRect; box: Box } | null {
  const r = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)?.getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0) return null;
  return { r, box: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) } };
}

// Where the element is now, and the first time it shows up, the scroll that brings it into view.
function measure(t: Tracker, anchor: string, now: number) {
  const found = boxOf(anchor);
  const { vw, vh } = screenSize();
  if (found && !t.seenAt) {
    t.seenAt = now;
    t.scrolling = bringIntoView(found.r, vw, vh);
    t.scrollStart = now;
  }
  if (t.scrolling && now - t.scrollStart > SCROLL_LIMIT) t.scrolling = false;
  const box = found?.box ?? null;
  t.still = same(box, t.previous) ? t.still + 1 : 0;
  t.previous = box;
  return { box, vw, vh };
}

// Settled: in place for a few frames, not scrolling and with the page's transition over, or on the screen for
// SETTLE_LIMIT whatever it does. From then on it just follows the element. Without a previous element, it first
// shows closed for one frame so it can open from there.
function settle(t: Tracker, box: Box | null, now: number) {
  if (t.settledAt || !box) return;
  const calm = !t.scrolling && t.still >= 3 && (!pageMoving() || now - t.start > TRANSITION_LIMIT);
  if (!calm && now - t.seenAt < SETTLE_LIMIT) return;
  if (t.from) t.settledAt = now;
  else t.from = collapsed(box);
}

// One frame of the loop: where the element is and what the tour shows for it.
function frameState(t: Tracker, anchor: string, pathname: string): AnchorState {
  const now = performance.now();
  const { box, vw, vh } = measure(t, anchor, now);
  settle(t, box, now);
  const settled = t.settledAt > 0 && !!box;
  return {
    anchor,
    pathname,
    box,
    settled,
    gliding: settled && !!t.from && now - t.settledAt < GLIDE,
    held: t.from,
    // Once seen, if it goes away (the screen changed) the bubble shows without it right away.
    missing: !box && (t.seenAt > 0 || now - t.start > WAIT),
    vw,
    vh,
  };
}

// Follows the element marked data-tour="<anchor>" on every frame: it can move with scroll, layout changes and
// view transitions. Once per step it brings the element into view and reports when it stopped moving, so the
// highlight and the bubble don't travel across the screen with the scroll (they used to).
// On the same page the highlight glides from the previous element; on a new page it opens in place, since the
// previous element isn't there anymore.
export function useAnchor(anchor: string | undefined, pathname: string): AnchorState {
  const [state, setState] = useState<AnchorState>({ box: null, settled: false, gliding: false, held: null, missing: false, vw: 0, vh: 0 });
  // The last settled element and its page, across steps: where the highlight glides from.
  const lastSettled = useRef<{ box: Box; pathname: string } | null>(null);

  useEffect(() => {
    if (!anchor) {
      // A centered step in between: the next highlight opens in place, it doesn't glide from far away.
      lastSettled.current = null;
      return;
    }
    const from = lastSettled.current?.pathname === pathname ? lastSettled.current.box : null;
    const t: Tracker = { start: performance.now(), from, seenAt: 0, scrolling: false, scrollStart: 0, previous: null, still: 0, settledAt: 0 };
    let last = "";
    let frame = 0;
    const onScrollEnd = () => (t.scrolling = false);
    window.addEventListener("scrollend", onScrollEnd);

    const loop = () => {
      const next = frameState(t, anchor, pathname);
      if (next.settled && next.box) lastSettled.current = { box: next.box, pathname };
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setState(next);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scrollend", onScrollEnd);
    };
  }, [anchor, pathname]);

  if (state.anchor === anchor && state.pathname === pathname) return state;
  // The step just changed and the loop hasn't run yet: on the same page the previous highlight stays still;
  // on a new page there's nothing to highlight yet.
  const held = state.pathname !== pathname ? null : state.settled ? state.box : state.held;
  return { box: null, settled: false, gliding: false, held, missing: false, vw: state.vw, vh: state.vh };
}
