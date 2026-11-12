"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { primaryButton } from "@/components/ui/styles";
import { demoViewAs } from "@/lib/auth/actions";
import { STAGES, STEPS, type Step } from "@/lib/demo/steps";
import { setTour, type TourState } from "@/lib/demo/tour";
import { useData } from "@/lib/groups/store";
import { Bubble } from "./Bubble";
import { PAD, type Box } from "./bubblePosition";
import { Centered, Floating, Spotlight } from "./Placement";
import { AwayBubble, FinalBubble, MissingBubble, SkipButton } from "./StepBubbles";
import { useAnchor } from "./useAnchor";

// The tour's overlay and bubble. The steps are data (lib/demo/steps.ts); this only shows them and notices when
// the visitor did what each one asks.

// Everything the tour draws lives in one layer with its own view-transition name (see app/globals.css): when the
// page changes, the content slides underneath while the layer stays as it is, instead of fading and sliding with it.
// The browser takes a picture of the layer on every page or tab change, with everything that overflows it: the
// highlight's 9999px shadow made that picture some 20000px wide, and on a slow or busy device the screen froze
// for seconds (sometimes over 20) on each change, so a step never showed. Painting is clipped to the screen.
export function Tour(props: { tour: TourState; pathname: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[75] print:hidden" style={{ viewTransitionName: "demo-tour", contain: "paint" }}>
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
