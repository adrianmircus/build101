"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { MathText } from "@/components/ui/MathText";
import { LANDING, PROFILE_PHRASES } from "./example";
import { SheetContent } from "./Sheet";

const noop = () => () => {};

// Direction C: the sentence that adapts (A) written on Tiza's board. The chosen profile is underlined with a chalk
// stroke, and the version is a sheet of paper resting on the board. Indigo, white and one amber; no borders.
export function HeroBoard() {
  const [current, setCurrent] = useState(PROFILE_PHRASES[1].id);
  const [showOriginal, setShowOriginal] = useState(false);
  // False on the server and while hydrating: without JS the sentence is plain text and the sheet shows dyslexia.
  const ready = useSyncExternalStore(noop, () => true, () => false);
  const phrase = PROFILE_PHRASES.find((p) => p.id === current)!;
  const version = LANDING.versions[current];

  // Where the chosen phrase sits inside the headline, to lay the select over it. Measured again when the phrase or
  // the layout changes (another profile, a resize, the font loading).
  const headline = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const outer = headline.current;
    const inner = word.current;
    if (!outer || !inner) return;
    const measure = () => {
      const o = outer.getBoundingClientRect();
      const w = inner.getBoundingClientRect();
      setBox({ left: w.left - o.left, top: w.top - o.top, width: w.width, height: w.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [current, ready]);

  return (
    <div className="grid gap-16 lg:grid-cols-[6fr_5fr] lg:items-start lg:gap-12">
      <div className="lg:pt-8">
        <div ref={headline} className="relative">
          {/* The profile goes on its own line: switching it only changes that line, the rest of the headline stays put. */}
          <h1 className="text-4xl leading-tight font-semibold text-white sm:text-5xl lg:text-6xl">
            <span className="block">El mismo práctico,</span>
            <span className="block">para quien tiene</span>
            <span ref={word} className="relative inline-grid whitespace-nowrap text-amber-300">
              <span className={`col-start-1 row-start-1 ${ready ? "pr-[0.9em]" : ""}`}>{phrase.phrase}</span>
              {ready && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="pointer-events-none col-start-1 row-start-1 h-[0.5em] w-[0.5em] self-center justify-self-end fill-none stroke-amber-300 stroke-[3]"
                >
                  <path d="M5 9l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <ChalkStroke />
            </span>
            .
          </h1>
          {/* Outside the <h1>, so the heading's text is the sentence and not every option. Laid exactly over the
              chosen phrase and transparent; its own font stays normal so the list that opens isn't headline-sized. */}
          {ready && box && (
            <select
              aria-label="Perfil del estudiante"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
                setShowOriginal(false);
              }}
              style={box}
              className="focus-on-dark absolute cursor-pointer appearance-none rounded-md bg-transparent text-lg text-transparent outline-offset-4"
            >
              {PROFILE_PHRASES.map((p) => (
                <option key={p.id} value={p.id} className="bg-white text-lg text-slate-900">
                  {p.phrase}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="mt-8 max-w-[680px] text-lg text-pretty text-indigo-50 sm:text-xl">
          Cargás tu práctico de matemática una vez. Tiza.ai arma una versión para cada estudiante del grupo, y vos
          aprobás cada una antes de que llegue a la clase.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          {/* A plain <a>: /demo sets the demo's cookies and the full reload makes the app pick its own data. */}
          <a
            href="/demo"
            className="focus-on-dark inline-flex min-h-11 items-center rounded-xl bg-amber-300 px-6 py-3 text-lg font-semibold text-indigo-950 transition-colors duration-300 ease-soft hover:bg-amber-200 active:translate-y-px"
          >
            Probar la demo
          </a>
          <p className="text-base text-indigo-100">Sin cuenta · 3 minutos</p>
        </div>
        <p className="mt-12 max-w-[680px] text-base text-indigo-100">
          Adaptaciones para TDAH, dislexia y TEA basadas en guías publicadas. Para dificultades motrices y de escritura,
          se responde con la mirada o dictando. Hecho en Montevideo.
        </p>
      </div>

      <figure>
        {/* A sheet of paper resting on the board: slightly tilted on wide screens, straight on phones. */}
        <div className="rounded-2xl bg-white p-8 text-slate-900 shadow-[0_32px_80px_rgb(0_0_0/0.35)] sm:p-10 lg:-rotate-2">
          <p className="text-base text-slate-600">
            {showOriginal ? "El práctico original" : `Para quien tiene ${phrase.phrase}`}
          </p>
          <div key={`${current}-${showOriginal}`} className="sheet-in mt-6">
            <SheetContent text={LANDING.original} version={showOriginal ? undefined : version} />
          </div>
        </div>
        <figcaption className="mt-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <span className="max-w-md text-lg text-indigo-50">
            {showOriginal ? "Así lo cargó el profe." : <MathText text={version.changes[0].what} inline />}
          </span>
          {ready && (
            <button
              type="button"
              onClick={() => setShowOriginal((v) => !v)}
              className="focus-on-dark min-h-11 text-lg font-semibold text-amber-300 underline underline-offset-4 transition-colors duration-300 ease-soft hover:text-amber-200"
            >
              {showOriginal ? "Ver la versión adaptada" : "Ver el original"}
            </button>
          )}
        </figcaption>
      </figure>
    </div>
  );
}

// A hand-drawn chalk underline: a slightly uneven stroke with rough ends, stretched to the word's width.
function ChalkStroke() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 16"
      preserveAspectRatio="none"
      className="pointer-events-none absolute -bottom-[0.12em] left-0 h-[0.16em] w-full"
    >
      <path
        d="M3 10 C 30 6, 55 12, 82 8 S 135 5, 160 9 S 190 8, 197 6"
        stroke="#fcd34d"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M12 12 C 60 10, 120 11, 186 9" stroke="#fcd34d" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
