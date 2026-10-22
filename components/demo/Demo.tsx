"use client";

import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useSyncExternalStore } from "react";
import { demoViewAs } from "@/lib/auth/actions";
import { isDemo } from "@/lib/demo/mode";
import { STAGES, STEPS } from "@/lib/demo/steps";
import { restartTour, setTour, useTour, type TourState } from "@/lib/demo/tour";
import { resetDemo } from "@/lib/groups/store";
import { Tour } from "./Tour";

const noSubscription = () => () => {};

// The guided demo from the landing: the bar on top and the tour. Outside the demo it renders nothing.
// Mounted in the root layout, so it survives every route and the switch between teacher and student.
export function Demo() {
  // The cookie only exists in the browser: on the server (and while hydrating) it's never the demo.
  const demo = useSyncExternalStore(noSubscription, isDemo, () => false);
  const tour = useTour();
  const pathname = usePathname();
  const router = useRouter();

  // /demo lands here with ?tour=inicio: the demo's data and the tour start from scratch, and the URL is cleaned up.
  useEffect(() => {
    if (!demo || new URLSearchParams(window.location.search).get("tour") !== "inicio") return;
    resetDemo();
    restartTour();
    router.replace(pathname);
  }, [demo, pathname, router]);

  if (!demo || !tour) return null;
  const current = tour.finished ? "Eso es Tiza.ai" : STEPS[tour.step]?.title;
  return (
    <>
      <DemoBar tour={tour} pathname={pathname} />
      <Tour tour={tour} pathname={pathname} />
      {/* Always in the page, so screen readers hear each new step even with focus elsewhere. */}
      <p role="status" className="sr-only">
        {tour.open && current ? `Recorrido: ${current}` : ""}
      </p>
    </>
  );
}

const barButton =
  "focus-on-dark inline-flex min-h-11 items-center rounded-lg px-3 text-base font-semibold text-white underline-offset-4 transition-colors hover:bg-white/10 hover:underline";

function DemoBar({ tour, pathname }: { tour: TourState; pathname: string }) {
  const stage = STEPS[tour.step]?.stage ?? 0;
  return (
    // Its own view-transition name, like the teacher header: it stays still while the page changes.
    <div className="sticky top-0 z-[80] bg-indigo-950 text-white print:hidden" style={{ viewTransitionName: "demo-bar" }}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 px-4 py-1">
        <span className="rounded-md bg-amber-300 px-2 py-0.5 text-base font-bold text-indigo-950">Demo</span>
        <p className="min-w-0 flex-1 truncate px-1 text-base text-indigo-100">
          {tour.finished ? "Recorrido terminado" : `${STAGES[stage]} · ${stage + 1} de ${STAGES.length}`}
        </p>
        {!tour.open && !tour.finished && (
          <button type="button" className={barButton} onClick={() => setTour({ open: true })}>
            Retomar recorrido
          </button>
        )}
        {tour.finished && (
          // A plain <a>: /demo reloads the page, like entering from the landing.
          <a href="/demo" className={barButton}>
            Volver a empezar
          </a>
        )}
        {pathname.startsWith("/estudiante") && (
          <button type="button" className={barButton} onClick={() => startTransition(() => demoViewAs("teacher"))}>
            Volver al profe
          </button>
        )}
        <a href="/demo/salir" className={barButton}>
          Salir
        </a>
      </div>
    </div>
  );
}
