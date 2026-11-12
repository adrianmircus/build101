"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MOBILE, placeBubble, type Box, type Side, type Size } from "./bubblePosition";

// Shows its content with a short fade once it's mounted and placed. Each new bubble fades in instead of popping.
function useAppear() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return shown;
}

const fade = (shown: boolean) =>
  `transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none ${shown ? "opacity-100" : "translate-y-1 opacity-0"}`;

// Darkens everything but the hole; without a hole yet, the whole screen. On action steps (and while moving between
// steps), four transparent panels around the hole block the clicks outside.
export function Spotlight({ hole, block, glide, vw, vh }: { hole: Box | null; block: boolean; glide: boolean; vw: number; vh: number }) {
  if (!hole) return <div aria-hidden="true" className="pointer-events-auto fixed inset-0 z-[70] bg-slate-950/60" />;
  const bottom = hole.top + hole.height;
  const right = hole.left + hole.width;
  const panels: Box[] = [
    { top: 0, left: 0, width: vw, height: Math.max(0, hole.top) },
    { top: bottom, left: 0, width: vw, height: Math.max(0, vh - bottom) },
    { top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height },
    { top: hole.top, left: right, width: Math.max(0, vw - right), height: hole.height },
  ];
  return (
    <>
      <div
        aria-hidden="true"
        // The transition only while gliding: afterwards the hole follows the element's scroll frame by frame, without lag.
        className={`pointer-events-none fixed z-[70] rounded-xl outline-3 outline-amber-300 ${
          glide ? "transition-[top,left,width,height] duration-[250ms] ease-out motion-reduce:transition-none" : ""
        }`}
        // The shadow darkens the rest of the screen. It only stays cheap because the tour's layer clips its painting
        // to the screen (contain: paint in Tour.tsx): without that, every page change froze slow devices.
        style={{ ...hole, boxShadow: "0 0 0 9999px rgb(2 6 23 / 0.6)" }}
      />
      {block && panels.map((p, i) => <div key={i} aria-hidden="true" className="pointer-events-auto fixed z-[70]" style={p} />)}
    </>
  );
}

// Next to the highlighted element, always whole inside the screen. Mounted once per step: it measures itself (layout
// effect, before paint) and from then on follows the element. It keeps its side while it still fits, and picks
// another one if the element grows or the screen changes.
export function Floating({ hole, vw, vh, children }: { hole: Box; vw: number; vh: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [side, setSide] = useState<Side>();
  const shown = useAppear();

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.offsetWidth, height: element.offsetHeight };
      setSize((s) => (s && s.width === next.width && s.height === next.height ? s : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const placed = size ? placeBubble({ hole, size, vw, vh }, side) : null;
  if (placed && placed.side !== side) setSide(placed.side);

  if (vw < MOBILE) return <Docked vw={vw} vh={vh}>{children}</Docked>;
  // Until it's measured it sits at the corner, see-through: it can still take focus (a hidden element can't).
  const style = placed ? { top: placed.top, left: placed.left } : { top: 0, left: 0 };
  return (
    <div
      ref={ref}
      className={`pointer-events-auto fixed z-[90] w-[min(24rem,calc(100vw-2rem))] ${fade(shown && !!placed)}`}
      style={style}
    >
      {children}
    </div>
  );
}

// Bottom-right corner on desktop; a sheet across the bottom on mobile. Doesn't darken or block anything.
// It sits in a frame the size of the screen the visitor sees (see screenSize), not of the page's layout viewport.
export function Docked({ vw, vh, children }: { vw: number; vh: number; children: ReactNode }) {
  const mobile = vw > 0 && vw < MOBILE;
  const shown = useAppear();
  return (
    <div
      className={`pointer-events-none fixed z-[90] flex items-end ${vh > 0 ? "top-0 left-0" : "inset-0"} ${mobile ? "" : "justify-end p-4"}`}
      style={vh > 0 ? { width: vw, height: vh } : undefined}
    >
      <div
        className={`pointer-events-auto ${fade(shown)} ${
          mobile ? "w-full [&>div]:rounded-b-none [&>div]:pb-[max(1.25rem,env(safe-area-inset-bottom))]" : "w-[min(24rem,calc(100vw-2rem))]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  const shown = useAppear();
  return (
    // m-auto instead of centering the grid: on a short screen the card scrolls instead of losing its top under the bar.
    <div className="pointer-events-auto fixed inset-0 z-[70] flex overflow-y-auto bg-slate-950/60 px-4 pt-16 pb-4">
      <div className={`m-auto w-full max-w-md ${fade(shown)}`}>{children}</div>
    </div>
  );
}
