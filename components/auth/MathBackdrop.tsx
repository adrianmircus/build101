// Symbols scattered over the notebook. Position, size and tilt per symbol.
const SYMBOLS = [
  { s: "π", left: 8, top: 18, size: 64, r: -8 },
  { s: "√x", left: 22, top: 70, size: 48, r: 6 },
  { s: "∑", left: 38, top: 12, size: 56, r: 4 },
  { s: "∫", left: 52, top: 82, size: 72, r: -6 },
  { s: "x²", left: 66, top: 22, size: 44, r: 10 },
  { s: "∞", left: 82, top: 64, size: 60, r: -4 },
  { s: "θ", left: 90, top: 30, size: 46, r: 8 },
  { s: "Δ", left: 14, top: 44, size: 42, r: -10 },
  { s: "≤", left: 74, top: 86, size: 40, r: 5 },
  { s: "f(x)", left: 44, top: 48, size: 38, r: -3 },
  { s: "½", left: 4, top: 86, size: 44, r: 7 },
  { s: "÷", left: 94, top: 8, size: 40, r: -7 },
];

// Decorative background for the login: solid color, notebook illustration, a curve and symbols.
// Static on purpose: nothing moves next to the form (WCAG 2.2.2 and less distraction for students
// with ADHD and ASD), no gradients or glows.
export function MathBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-indigo-950">
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative SVG, no optimization needed */}
      <img src="/login-math.svg" alt="" className="absolute inset-0 h-full w-full object-cover" />

      <svg className="absolute inset-x-0 bottom-0 h-1/2 w-full" viewBox="0 0 1440 400" preserveAspectRatio="none">
        <path
          d="M0 300 C 180 120, 360 120, 540 260 S 900 400, 1080 220 S 1340 80, 1440 160"
          stroke="#fcd34d"
          strokeOpacity="0.4"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </svg>

      {SYMBOLS.map((sym) => (
        <span
          key={sym.s}
          className="absolute select-none font-serif italic text-indigo-100/20"
          style={{ left: `${sym.left}%`, top: `${sym.top}%`, fontSize: sym.size, transform: `rotate(${sym.r}deg)` }}
        >
          {sym.s}
        </span>
      ))}
    </div>
  );
}
