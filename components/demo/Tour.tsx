"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { primaryButton, secondaryButton } from "@/components/ui/styles";
import { demoViewAs } from "@/lib/auth/actions";
import { STAGES, STEPS, type Step } from "@/lib/demo/steps";
import { setTour, type TourState } from "@/lib/demo/tour";
import { useData } from "@/lib/groups/store";

// The tour's overlay and bubble. The steps are data (lib/demo/steps.ts); this only shows them and notices when
// the visitor did what each one asks.

type Box = { top: number; left: number; width: number; height: number };

// Space around the highlighted element, the gap to the bubble and the margin to the screen's edges.
const PAD = 8;
const GAP = 16;
const EDGE = 16;
// Below the demo bar (about 60px tall when it wraps on a phone).
const TOP = 72;
// Under this width the bubble is a sheet at the bottom of the screen.
const MOBILE = 640;
// The bubble's usual height, to make room for it before it's measured.
const BUBBLE = 320;
// How long to wait for an element that isn't there yet before showing the bubble without it.
const WAIT = 3000;

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex='-1'])";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// How long the highlight takes to glide from the previous element to the new one.
const GLIDE = 250;
// If the scroll never reports its end (browsers without scrollend), the step shows anyway after this.
const SCROLL_LIMIT = 900;

type AnchorState = {
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

const same = (a: Box | null, b: Box | null) =>
  !!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

// A point in the middle of the element: on a new page the highlight opens from there.
const collapsed = (box: Box): Box => ({ top: box.top + box.height / 2, left: box.left + box.width / 2, width: 0, height: 0 });

// The page's own view transition (the content sliding between pages) is still playing.
const pageMoving = () =>
  document.getAnimations().some((a) => {
    const target = (a.effect as KeyframeEffect | null)?.pseudoElement ?? "";
    return target.startsWith("::view-transition") && !target.includes("demo-");
  });

// Follows the element marked data-tour="<anchor>" on every frame: it can move with scroll, layout changes and
// view transitions. Once per step it brings the element into view and reports when it stopped moving, so the
// highlight and the bubble don't travel across the screen with the scroll (they used to).
// On the same page the highlight glides from the previous element; on a new page it opens in place, since the
// previous element isn't there anymore.
function useAnchor(anchor: string | undefined, pathname: string): AnchorState {
  const [state, setState] = useState<AnchorState>({ box: null, settled: false, gliding: false, held: null, missing: false, vw: 0, vh: 0 });
  // The last settled element and its page, across steps: where the highlight glides from.
  const lastSettled = useRef<{ box: Box; pathname: string } | null>(null);

  useEffect(() => {
    if (!anchor) {
      // A centered step in between: the next highlight opens in place, it doesn't glide from far away.
      lastSettled.current = null;
      return;
    }
    const start = performance.now();
    let from = lastSettled.current?.pathname === pathname ? lastSettled.current.box : null;
    let seen = false;
    let scrolling = false;
    let scrollStart = 0;
    let previous: Box | null = null;
    let still = 0;
    let settledAt = 0;
    let last = "";
    let frame = 0;
    const onScrollEnd = () => (scrolling = false);
    window.addEventListener("scrollend", onScrollEnd);

    const loop = () => {
      const now = performance.now();
      const element = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
      const r = element?.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const visible = !!r && r.width > 0 && r.height > 0;
      if (r && visible && !seen) {
        seen = true;
        scrolling = bringIntoView(r, vw, vh);
        scrollStart = now;
      }
      if (scrolling && now - scrollStart > SCROLL_LIMIT) scrolling = false;
      const box = visible
        ? { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }
        : null;
      still = same(box, previous) ? still + 1 : 0;
      previous = box;
      // Settled: in place for a few frames, not scrolling and with the page's transition over. From then on it just
      // follows the element. Without a previous element, it first shows closed for one frame so it can open from there.
      if (!settledAt && box && !scrolling && still >= 3 && !pageMoving()) {
        if (from) settledAt = now;
        else from = collapsed(box);
      }
      const settled = settledAt > 0 && !!box;
      if (settled) lastSettled.current = { box, pathname };
      const next: AnchorState = {
        anchor,
        pathname,
        box,
        settled,
        gliding: settled && !!from && now - settledAt < GLIDE,
        held: from,
        // Once seen, if it goes away (the screen changed) the bubble shows without it right away.
        missing: !box && (seen || now - start > WAIT),
        vw,
        vh,
      };
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

// Mobile: in the top part, above the sheet. Desktop: with room for the bubble below or above it, so the bubble
// doesn't end up docked over the element; if the element is too tall for that, just in view.
// Returns whether it scrolled.
function bringIntoView(r: DOMRect, vw: number, vh: number): boolean {
  const scroll = (top: number) => {
    if (Math.abs(top) < 2) return false;
    window.scrollBy({ top, behavior: reducedMotion() ? "auto" : "smooth" });
    return true;
  };
  if (vw < MOBILE) return r.top < TOP || r.bottom > vh * 0.55 ? scroll(r.top - TOP) : false;
  const visible = r.top >= TOP && r.bottom <= vh - EDGE;
  if (r.height + GAP + BUBBLE > vh - TOP - EDGE) return visible ? false : scroll(r.top - TOP);
  const roomBelow = r.bottom + GAP + BUBBLE <= vh - EDGE;
  const roomAbove = r.top - GAP - BUBBLE >= TOP;
  if (visible && (roomBelow || roomAbove)) return false;
  // The element and the bubble below it, centered together.
  return scroll(r.top - Math.max(TOP + PAD, (vh - (r.height + GAP + BUBBLE)) / 2));
}

type Side = "below" | "above" | "right" | "left" | "dock";
type Size = { width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

// Below the element if it fits; otherwise above, to the right or to the left. Without room: docked in a corner.
// Chosen once per step: if it were chosen on every frame, the bubble would jump sides while the page scrolls.
function chooseSide(hole: Box, { width: w, height: h }: Size, vw: number, vh: number): Side {
  if (hole.top + hole.height + GAP + h <= vh - EDGE) return "below";
  if (hole.top - GAP - h >= TOP) return "above";
  if (hole.left + hole.width + GAP + w <= vw - EDGE) return "right";
  if (hole.left - GAP - w >= EDGE) return "left";
  return "dock";
}

// Where the bubble goes on its side, following the element.
function position(side: Exclude<Side, "dock">, hole: Box, { width: w, height: h }: Size, vw: number, vh: number) {
  const centered = clamp(hole.left + hole.width / 2 - w / 2, EDGE, vw - w - EDGE);
  const beside = clamp(hole.top, TOP, vh - h - EDGE);
  if (side === "below") return { top: hole.top + hole.height + GAP, left: centered };
  if (side === "above") return { top: hole.top - GAP - h, left: centered };
  if (side === "right") return { top: beside, left: hole.left + hole.width + GAP };
  return { top: beside, left: hole.left - GAP - w };
}

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

// "Tocá *Generar 3 versiones*." → the button's name in italics.
function Body({ text }: { text: string }) {
  return text.split(/\*(.+?)\*/).map((part, i) =>
    i % 2 === 1 ? (
      <em key={i} className="font-semibold">
        {part}
      </em>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

// Everything the tour draws lives in one layer with its own view-transition name (see app/globals.css): when the
// page changes, the content slides underneath while the layer stays as it is, instead of fading and sliding with it.
export function Tour(props: { tour: TourState; pathname: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[75] print:hidden" style={{ viewTransitionName: "demo-tour" }}>
      <TourContent {...props} />
    </div>
  );
}

function TourContent({ tour, pathname }: { tour: TourState; pathname: string }) {
  const data = useData();
  const router = useRouter();
  const [switching, startSwitch] = useTransition();
  const step: Step | undefined = tour.finished ? undefined : STEPS[tour.step];
  const onRoute = !!step && step.route.test(pathname);
  const anchor = useAnchor(tour.open && onRoute ? step?.anchor : undefined, pathname);

  // Right after an action step changes the page, the step is behind the route for a moment: that's not leaving the
  // tour. "Te fuiste del recorrido" only shows if it lasts.
  const awayKey = !onRoute && step ? `${step.id}@${pathname}` : null;
  const [awayConfirmed, setAwayConfirmed] = useState<string | null>(null);
  useEffect(() => {
    if (!awayKey) return;
    const timer = setTimeout(() => setAwayConfirmed(awayKey), 400);
    return () => clearTimeout(timer);
  }, [awayKey]);

  const advance = useCallback(() => {
    if (tour.step + 1 >= STEPS.length) setTour({ finished: true, open: true });
    else setTour({ step: tour.step + 1 });
  }, [tour.step]);

  // The visitor did what the step asks. It's checked even with the bubble closed, so "Retomar" picks up where they are.
  useEffect(() => {
    if (step?.done?.({ pathname, data })) advance();
  }, [step, pathname, data, advance]);

  useEffect(() => {
    if (!step?.doneOnClick || !step.anchor || !onRoute) return;
    const selector = `[data-tour="${step.anchor}"]`;
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(selector)) advance();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [step, onRoute, advance]);

  // Room at the bottom of the page: an element near the end can still scroll up and leave room for the bubble.
  useEffect(() => {
    if (!tour.open) return;
    document.body.style.paddingBottom = "50vh";
    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [tour.open]);

  // Esc closes the bubble, like "Saltear recorrido"; the bar offers to pick it up again.
  useEffect(() => {
    if (!tour.open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setTour({ open: false });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tour.open]);

  const skip = () => setTour({ open: false });

  // Back to the step's screen, switching between teacher and Paula if needed.
  const goBack = () => {
    if (!step) return;
    const { role, href } = step.back(data);
    const inArea = role === "teacher" ? pathname.startsWith("/grupos") : pathname.startsWith("/estudiante");
    if (inArea) router.push(href);
    else startSwitch(() => demoViewAs(role, href));
  };

  if (!tour.open) return null;

  const stageLabel = (stage: number) => `${STAGES[stage]} · ${stage + 1} de ${STAGES.length}`;

  if (!step) {
    return (
      <Centered>
        <Bubble
          id="final"
          label="Fin del recorrido"
          title="Eso es Tiza.ai"
          body="Un práctico, una versión para cada estudiante, y vos aprobás cada una antes de que llegue."
          actions={
            <div className="grid w-full gap-3">
              <a href="/demo" className={primaryButton}>
                Volver a empezar
              </a>
              <button type="button" className={secondaryButton} onClick={skip}>
                Seguir explorando
              </button>
              <a
                href="/demo/salir"
                className="inline-flex min-h-11 items-center justify-center rounded-md text-base text-slate-700 underline underline-offset-4 hover:text-slate-950"
              >
                Salir de la demo
              </a>
            </div>
          }
        />
      </Centered>
    );
  }

  const skipButton = (
    <button
      type="button"
      className="inline-flex min-h-11 items-center rounded-md text-base text-slate-700 underline underline-offset-4 hover:text-slate-950"
      onClick={skip}
    >
      Saltear recorrido
    </button>
  );

  if (!onRoute) {
    // Meanwhile the screen stays dark, as it will be for the next step: nothing blinks.
    if (awayConfirmed !== awayKey) return <div aria-hidden="true" className="fixed inset-0 z-[70] bg-slate-950/60" />;
    return (
      <Docked key={`away-${step.id}`} vw={anchor.vw}>
        <Bubble
          id={`away-${step.id}`}
          label={stageLabel(step.stage)}
          title="Te fuiste del recorrido"
          body={`Estabas en «${step.title}».`}
          actions={
            <>
              {skipButton}
              <button type="button" className={primaryButton} onClick={goBack} disabled={switching}>
                {switching ? "Volviendo…" : "Volver al recorrido"}
              </button>
            </>
          }
        />
      </Docked>
    );
  }

  const nextButton = step.next && (
    <button
      type="button"
      className={primaryButton}
      disabled={switching}
      onClick={() => (step.viewAsStudent ? startSwitch(() => demoViewAs("student")) : advance())}
    >
      {switching ? "Entrando…" : step.next}
    </button>
  );
  const bubble = (
    <Bubble
      id={step.id}
      label={stageLabel(step.stage)}
      title={step.title}
      body={step.body}
      anchor={step.kind === "action" ? step.anchor : undefined}
      actions={
        <>
          {skipButton}
          {nextButton}
        </>
      }
    />
  );

  if (step.kind === "center") return <Centered key={step.id}>{bubble}</Centered>;

  // The element isn't on the screen: the bubble shows anyway, docked and with a way forward, so it never gets stuck.
  if (anchor.missing) {
    return (
      <Docked key={`${step.id}-docked`} vw={anchor.vw}>
        <Bubble
          id={`${step.id}-docked`}
          label={stageLabel(step.stage)}
          title={step.title}
          body={step.body}
          actions={
            <>
              {skipButton}
              <button type="button" className={primaryButton} onClick={advance}>
                {step.next ?? "Seguir"}
              </button>
            </>
          }
        />
      </Docked>
    );
  }

  // While the page scrolls to the new element the highlight stays where it was and the bubble waits; then the
  // highlight glides to the element and the bubble appears next to it, already measured. No travelling around.
  const pad = (box: Box) => ({ top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 });
  const target = anchor.settled && anchor.box ? anchor.box : anchor.held;
  return (
    <>
      <Spotlight
        hole={target && pad(target)}
        block={step.kind === "action" || !anchor.settled}
        glide={anchor.gliding}
        vw={anchor.vw}
        vh={anchor.vh}
      />
      {anchor.settled && !anchor.gliding && anchor.box && (
        <Floating key={step.id} hole={pad(anchor.box)} vw={anchor.vw} vh={anchor.vh}>
          {bubble}
        </Floating>
      )}
    </>
  );
}

// Darkens everything but the hole; without a hole yet, the whole screen. On action steps (and while moving between
// steps), four transparent panels around the hole block the clicks outside.
function Spotlight({ hole, block, glide, vw, vh }: { hole: Box | null; block: boolean; glide: boolean; vw: number; vh: number }) {
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
        style={{ ...hole, boxShadow: "0 0 0 9999px rgb(2 6 23 / 0.6)" }}
      />
      {block && panels.map((p, i) => <div key={i} aria-hidden="true" className="pointer-events-auto fixed z-[70]" style={p} />)}
    </>
  );
}

// Next to the highlighted element. Mounted once per step: it measures itself before it's seen (layout effect,
// before paint), picks its side once and then only follows the element on that side.
function Floating({ hole, vw, vh, children }: { hole: Box; vw: number; vh: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ size: Size; side: Side; vw: number; vh: number } | null>(null);
  const shown = useAppear();

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const size = { width: element.offsetWidth, height: element.offsetHeight };
      // The side is kept while the size and the window stay the same.
      setLayout((l) =>
        l && l.size.width === size.width && l.size.height === size.height && l.vw === vw && l.vh === vh
          ? l
          : { size, side: chooseSide(hole, size, vw, vh), vw, vh },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // hole is left out on purpose: following the element must not re-pick the side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vw, vh]);

  if (vw < MOBILE || layout?.side === "dock") return <Docked vw={vw}>{children}</Docked>;
  const style = layout ? position(layout.side as Exclude<Side, "dock">, hole, layout.size, vw, vh) : { top: 0, left: 0 };
  return (
    <div
      ref={ref}
      className={`pointer-events-auto fixed z-[90] w-[min(24rem,calc(100vw-2rem))] ${fade(shown && !!layout)} ${layout ? "" : "invisible"}`}
      style={style}
    >
      {children}
    </div>
  );
}

// Bottom-right corner on desktop; a sheet across the bottom on mobile. Doesn't darken or block anything.
function Docked({ vw, children }: { vw: number; children: ReactNode }) {
  const mobile = vw > 0 && vw < MOBILE;
  const shown = useAppear();
  return (
    <div
      className={`pointer-events-auto fixed z-[90] ${fade(shown)} ${
        mobile ? "inset-x-0 bottom-0 [&>div]:rounded-b-none [&>div]:pb-[max(1.25rem,env(safe-area-inset-bottom))]" : "right-4 bottom-4 w-[min(24rem,calc(100vw-2rem))]"
      }`}
    >
      {children}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  const shown = useAppear();
  return (
    // m-auto instead of centering the grid: on a short screen the card scrolls instead of losing its top under the bar.
    <div className="pointer-events-auto fixed inset-0 z-[70] flex overflow-y-auto bg-slate-950/60 px-4 pt-16 pb-4">
      <div className={`m-auto w-full max-w-md ${fade(shown)}`}>{children}</div>
    </div>
  );
}

// Non-modal dialog: the highlighted element has to stay usable. Focus comes to the title on each new bubble;
// on action steps, Tab from the bubble goes straight to the highlighted element.
function Bubble({
  id,
  label,
  title,
  body,
  actions,
  anchor,
}: {
  id: string;
  label: string;
  title: string;
  body: string;
  actions: ReactNode;
  anchor?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [id]);

  const toAnchor = (e: KeyboardEvent) => {
    if (!anchor || e.key !== "Tab" || e.shiftKey || !ref.current) return;
    const own = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (document.activeElement !== titleRef.current && document.activeElement !== own.at(-1)) return;
    const element = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
    const target = element?.matches(FOCUSABLE) ? element : element?.querySelector<HTMLElement>(FOCUSABLE);
    if (!target) return;
    e.preventDefault();
    target.focus();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={`tour-${id}-title`}
      aria-describedby={`tour-${id}-body`}
      onKeyDown={toAnchor}
      className="rounded-2xl bg-white p-5 text-slate-900 shadow-2xl shadow-black/40 ring-1 ring-slate-900/10 sm:p-6"
    >
      <p className="text-base font-semibold text-indigo-800">{label}</p>
      {/* Focused by code, not by the visitor: no ring (inline, the global :focus-visible rule wins over classes). */}
      <h2 id={`tour-${id}-title`} ref={titleRef} tabIndex={-1} className="mt-1 text-xl font-bold" style={{ outline: "none" }}>
        {title}
      </h2>
      <p id={`tour-${id}-body`} className="mt-2 text-lg leading-relaxed">
        <Body text={body} />
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">{actions}</div>
    </div>
  );
}
