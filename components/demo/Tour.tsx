"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { primaryButton } from "@/components/ui/styles";
import { demoViewAs } from "@/lib/auth/actions";
import { STAGES, STEPS, type Step } from "@/lib/demo/steps";
import { setTour, type TourState } from "@/lib/demo/tour";
import { useData } from "@/lib/groups/store";
import { Bubble } from "./Bubble";
import { PAD, bringIntoView, screenSize, type Box } from "./bubblePosition";
import { Centered, Floating, Spotlight } from "./Placement";
import { AwayBubble, FinalBubble, MissingBubble, SkipButton } from "./StepBubbles";

// The tour's overlay and bubble. The steps are data (lib/demo/steps.ts); this only shows them and notices when
// the visitor did what each one asks.

// How long to wait for an element that isn't there yet before showing the bubble without it.
const WAIT = 3000;

// How long the highlight takes to glide from the previous element to the new one.
const GLIDE = 250;
// If the scroll never reports its end (browsers without scrollend), the step shows anyway after this.
const SCROLL_LIMIT = 900;
// Longest the tour waits for the page's own transition before showing anyway.
const TRANSITION_LIMIT = 1500;

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

// The page's own view transition (the content sliding between pages) is still playing. Only running or pending
// ones count: a finished animation can stay in getAnimations() (fill mode) and used to hold the tour forever.
const pageMoving = () =>
  document.getAnimations().some((a) => {
    if (a.playState !== "running" && !a.pending) return false;
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
      const { vw, vh } = screenSize();
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
      if (!settledAt && box && !scrolling && still >= 3 && (!pageMoving() || now - start > TRANSITION_LIMIT)) {
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

  if (!step) return <FinalBubble onSkip={skip} />;

  const skipButton = <SkipButton onSkip={skip} />;

  if (!onRoute) {
    // Meanwhile the screen stays dark, as it will be for the next step: nothing blinks.
    if (awayConfirmed !== awayKey) return <div aria-hidden="true" className="fixed inset-0 z-[70] bg-slate-950/60" />;
    return (
      <AwayBubble
        key={step.id}
        id={step.id}
        label={stageLabel(step.stage)}
        step={step.title}
        vw={anchor.vw}
        vh={anchor.vh}
        onSkip={skip}
        onBack={goBack}
        busy={switching}
      />
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
      <MissingBubble
        key={step.id}
        id={step.id}
        label={stageLabel(step.stage)}
        title={step.title}
        body={step.body}
        next={step.next ?? "Seguir"}
        vw={anchor.vw}
        vh={anchor.vh}
        onSkip={skip}
        onNext={advance}
      />
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
