"use client";

import { useEffect, useRef } from "react";

const REVEAL_ALL = "landing:reveal-all";

// Shows every pending section at once, without the rise. The nav calls it before jumping to a section: otherwise
// the browser scrolls to where the section is while it's still 32px low, and it ends up under the nav.
export function revealAll() {
  window.dispatchEvent(new Event(REVEAL_ALL));
}

// A section that rises into place the first time it scrolls into view (docs/LANDING.md, "Movimiento").
// The server renders it visible. Only once mounted, and only if it's still below the fold, it hides itself until
// it enters: if JS never runs, everything is simply there. With reduced motion it never hides.
export function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.dataset.pending = "";
    const show = () => {
      delete el.dataset.pending;
      observer.disconnect();
      window.removeEventListener(REVEAL_ALL, showNow);
    };
    const showNow = () => {
      el.style.transition = "none";
      show();
      void el.offsetHeight; // apply the final position before the transition comes back
      el.style.transition = "";
    };
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && show(), {
      rootMargin: "0px 0px -10% 0px",
    });
    observer.observe(el);
    window.addEventListener(REVEAL_ALL, showNow);
    return () => {
      observer.disconnect();
      window.removeEventListener(REVEAL_ALL, showNow);
      delete el.dataset.pending;
    };
  }, []);

  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  );
}
