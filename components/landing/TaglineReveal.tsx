"use client";

import { useEffect, useRef } from "react";

// The skill's tagline reveal (B11): words go from a muted tone to white, in reading order, as they cross a line at
// 60% of the screen. The server renders every word lit, so without JS or with reduced motion the sentence is just
// there. Screen readers get the plain sentence; the split words are decorative.
export function TaglineReveal({ lines, className = "" }: { lines: string[]; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const words = Array.from(ref.current?.querySelectorAll<HTMLElement>(".tagline-word") ?? []);
    let frame = 0;
    const update = () => {
      frame = 0;
      const trigger = window.innerHeight * 0.6;
      for (const word of words) {
        if (word.getBoundingClientRect().top < trigger) word.dataset.lit = "";
        else delete word.dataset.lit;
      }
    };
    // One update per frame at most: never work on every scroll event.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      for (const word of words) word.dataset.lit = "";
    };
  }, []);

  return (
    <p ref={ref} className={className}>
      <span className="sr-only">{lines.join(" ")}</span>
      <span aria-hidden="true">
        {lines.map((line, i) => (
          <span key={i} className="block">
            {line.split(" ").map((word, j) => (
              <span key={j} data-lit="" className="tagline-word">
                {word}{" "}
              </span>
            ))}
          </span>
        ))}
      </span>
    </p>
  );
}
