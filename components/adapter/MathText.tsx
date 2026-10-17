"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import { parse } from "mathjs";
import { Fragment } from "react";
import type { MathObject } from "@/lib/adapter/adapt-schemas";
import { normalize } from "@/lib/adapter/equivalence";

// Placeholders ({{m1}}) and the one bold verb (**Resolvé**) the dyslexia format allows.
const TOKEN = /(\{\{m\d+\}\}|\*\*[^*]+\*\*)/g;

// mathjs → LaTeX, for the solved example's steps, which come in mathjs only.
export function mathjsToTex(src: string): string {
  try {
    return normalize(src)
      .split("=")
      .map((side) => parse(side).toTex())
      .join(" = ");
  } catch {
    return src;
  }
}

// KaTeX with HTML and MathML and nothing on top: no aria-label or role="math", so NVDA with MathCAT can
// navigate the formula and send it to braille. The Spanish reading goes in a separate audio button.
// display: a formula on its own line ($$…$$), centered and scrolling sideways if it doesn't fit.
export function Tex({ latex, display = false }: { latex: string; display?: boolean }) {
  const html = katex.renderToString(latex, { throwOnError: false, output: "htmlAndMathml", displayMode: display });
  if (display) return <div className="my-3 overflow-x-auto overflow-y-hidden" dangerouslySetInnerHTML={{ __html: html }} />;
  return <span className="mx-0.5 inline-block align-middle" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MathText({
  text,
  math,
  onFormulaAudio,
}: {
  text: string;
  math: Map<string, MathObject>;
  onFormulaAudio?: (m: MathObject) => void;
}) {
  const parts = text.split(TOKEN).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        const marker = /^\{\{(m\d+)\}\}$/.exec(part);
        if (marker) {
          const m = math.get(marker[1]);
          if (!m) return <Fragment key={i}>[fórmula que falta]</Fragment>;
          return (
            <Fragment key={i}>
              <Tex latex={m.latex || mathjsToTex(m.mathjs)} />
              {onFormulaAudio && (
                <button
                  type="button"
                  onClick={() => onFormulaAudio(m)}
                  className="mx-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg align-middle text-indigo-800 hover:bg-indigo-50 print:hidden"
                >
                  <SpeakerIcon />
                  <span className="sr-only">Escuchar la fórmula {m.id.slice(1)}</span>
                </button>
              )}
            </Fragment>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

export function SpeakerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
    </svg>
  );
}
