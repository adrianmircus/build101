"use client";

import { useState } from "react";

// Symbols scattered over the notebook. Position, size, tilt and float timing per symbol.
const SYMBOLS = [
  { s: "π", left: 8, top: 18, size: 64, r: -8, dur: 11, delay: -2 },
  { s: "√x", left: 22, top: 70, size: 48, r: 6, dur: 14, delay: -7 },
  { s: "∑", left: 38, top: 12, size: 56, r: 4, dur: 12, delay: -4 },
  { s: "∫", left: 52, top: 82, size: 72, r: -6, dur: 16, delay: -9 },
  { s: "x²", left: 66, top: 22, size: 44, r: 10, dur: 10, delay: -1 },
  { s: "∞", left: 82, top: 64, size: 60, r: -4, dur: 15, delay: -6 },
  { s: "θ", left: 90, top: 30, size: 46, r: 8, dur: 13, delay: -3 },
  { s: "Δ", left: 14, top: 44, size: 42, r: -10, dur: 12, delay: -8 },
  { s: "≤", left: 74, top: 86, size: 40, r: 5, dur: 11, delay: -5 },
  { s: "f(x)", left: 44, top: 48, size: 38, r: -3, dur: 17, delay: -10 },
  { s: "½", left: 4, top: 86, size: 44, r: 7, dur: 14, delay: -2 },
  { s: "÷", left: 94, top: 8, size: 40, r: -7, dur: 10, delay: -6 },
];

// Sine-like wave: one period is 720 units wide, drawn over 2880 so it can slide 720 and loop seamlessly.
function wave(y: number, amplitude: number) {
  let d = `M0 ${y} C 120 ${y - amplitude}, 240 ${y - amplitude}, 360 ${y}`;
  for (let x = 360, up = false; x < 2880; x += 360, up = !up) {
    d += ` S ${x + 240} ${up ? y - amplitude : y + amplitude}, ${x + 360} ${y}`;
  }
  return d;
}

// Decorative background for the login: notebook illustration, waves and floating symbols.
// Slow and low-contrast so it doesn't compete with the form. It stops with the button
// (WCAG 2.2.2) and with the system's reduced-motion setting (see .login-anim in globals.css).
export function MathBackdrop() {
  const [paused, setPaused] = useState(false);
  return (
    <>
      <div
        aria-hidden="true"
        data-paused={paused || undefined}
        className="login-backdrop pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-indigo-950"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative SVG, no optimization needed */}
        <img src="/login-math.svg" alt="" className="login-anim login-reveal absolute inset-0 h-full w-full object-cover" />

        <svg className="absolute inset-x-0 bottom-0 h-1/2 w-full" viewBox="0 0 1440 400" preserveAspectRatio="none">
          <g className="login-anim login-wave-slow">
            <path d={wave(300, 70)} stroke="#a5b4fc" strokeOpacity="0.25" strokeWidth="2" fill="none" />
          </g>
          <g className="login-anim login-wave">
            <path d={wave(250, 110)} stroke="#fcd34d" strokeOpacity="0.4" strokeWidth="3" strokeLinecap="round" fill="none" />
          </g>
        </svg>

        {SYMBOLS.map((sym) => (
          <span
            key={sym.s}
            className="login-anim login-float absolute select-none font-serif italic text-indigo-100/20"
            style={{
              left: `${sym.left}%`,
              top: `${sym.top}%`,
              fontSize: sym.size,
              rotate: `${sym.r}deg`,
              animationDuration: `${sym.dur}s`,
              animationDelay: `${sym.delay}s`,
            }}
          >
            {sym.s}
          </span>
        ))}
      </div>

      <button
        type="button"
        aria-pressed={paused}
        onClick={() => setPaused((p) => !p)}
        className="focus-on-dark absolute right-4 bottom-1 z-10 inline-flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-indigo-100 underline-offset-4 hover:underline motion-reduce:hidden"
      >
        {paused ? "Reanudar animación" : "Pausar animación"}
      </button>
    </>
  );
}
