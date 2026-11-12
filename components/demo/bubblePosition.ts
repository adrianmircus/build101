// Where the tour's bubble goes. Pure functions: the bubble itself and the hooks only measure and call these.

export type Box = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
// "over" is the last resort: the element is so big that the bubble can't go beside it without leaving the screen,
// so it sits on the screen's edge, on the side farthest from the element's middle.
export type Side = "below" | "above" | "right" | "left" | "over";
export type Placement = { side: Side; top: number; left: number };

// Space around the highlighted element, the gap to the bubble and the margin to the screen's edges.
export const PAD = 8;
export const GAP = 16;
export const EDGE = 16;
// Below the demo bar (about 60px tall when it wraps on a phone).
export const TOP = 72;
// Under this width the bubble is a sheet at the bottom of the screen.
export const MOBILE = 640;
// The bubble's usual height, to make room for it before it's measured.
const BUBBLE = 320;

const ORDER: Side[] = ["below", "above", "right", "left"];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

// The element's box, the bubble's size and the screen's, everything a placement depends on.
export type Layout = { hole: Box; size: Size; vw: number; vh: number };
type Beside = Exclude<Side, "over">;

// The bubble's corner on each side, kept inside the screen along the side's cross axis.
function corner(side: Beside, { hole, size, vw, vh }: Layout) {
  const { width: w, height: h } = size;
  const centered = clamp(hole.left + hole.width / 2 - w / 2, EDGE, vw - w - EDGE);
  const beside = clamp(hole.top, TOP, vh - h - EDGE);
  if (side === "below") return { top: hole.top + hole.height + GAP, left: centered };
  if (side === "above") return { top: hole.top - GAP - h, left: centered };
  if (side === "right") return { top: beside, left: hole.left + hole.width + GAP };
  return { top: beside, left: hole.left - GAP - w };
}

// Whether the bubble, whole, fits on that side without leaving the area under the demo bar.
function fits(side: Beside, layout: Layout): boolean {
  const { top, left } = corner(side, layout);
  const { size, vw, vh } = layout;
  return top >= TOP && top + size.height <= vh - EDGE && left >= EDGE && left + size.width <= vw - EDGE;
}

function over({ hole, size, vw, vh }: Layout): Placement {
  const onTheLeft = hole.left + hole.width / 2 < vw / 2;
  return { side: "over", top: clamp(vh - size.height - EDGE, TOP, vh), left: onTheLeft ? vw - size.width - EDGE : EDGE };
}

// The first side where the bubble fits entirely: the one it already had if it still fits (so it doesn't hop from
// side to side while the page scrolls), then below, above, right and left. Always returns a spot inside the screen.
export function placeBubble(layout: Layout, current?: Side): Placement {
  const candidates = current && current !== "over" ? [current, ...ORDER] : ORDER;
  const side = candidates.find((s): s is Beside => s !== "over" && fits(s, layout));
  return side ? { side, ...corner(side, layout) } : over(layout);
}

// What the visitor sees. A page wider than the phone can stretch the layout viewport (the fixed layer) beyond the
// screen, and a sheet pinned to its bottom edge would sit below the fold: the visual viewport is the real screen.
// While pinch-zoomed it is only a part of the page, so then the layout viewport is used as before.
export function screenSize(): { vw: number; vh: number } {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const visual = window.visualViewport;
  if (!visual || visual.scale !== 1) return { vw, vh };
  return { vw: Math.min(vw, Math.round(visual.width)), vh: Math.min(vh, Math.round(visual.height)) };
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollBy(top: number): boolean {
  if (Math.abs(top) < 2) return false;
  window.scrollBy({ top, behavior: reducedMotion() ? "auto" : "smooth" });
  return true;
}

// Mobile: in the top part, above the sheet. Desktop: with room for the bubble below or above it, so the bubble
// doesn't end up docked over the element; if the element is too tall for that, just in view.
// Returns whether it scrolled.
export function bringIntoView(r: DOMRect, vw: number, vh: number): boolean {
  if (vw < MOBILE) return r.top < TOP || r.bottom > vh * 0.55 ? scrollBy(r.top - TOP) : false;
  const visible = r.top >= TOP && r.bottom <= vh - EDGE;
  if (r.height + GAP + BUBBLE > vh - TOP - EDGE) return visible ? false : scrollBy(r.top - TOP);
  const roomBelow = r.bottom + GAP + BUBBLE <= vh - EDGE;
  const roomAbove = r.top - GAP - BUBBLE >= TOP;
  if (visible && (roomBelow || roomAbove)) return false;
  // The element and the bubble below it, centered together.
  return scrollBy(r.top - Math.max(TOP + PAD, (vh - (r.height + GAP + BUBBLE)) / 2));
}
