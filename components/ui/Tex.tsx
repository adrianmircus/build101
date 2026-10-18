"use client";

import katex from "katex";
import "katex/dist/katex.min.css";

// KaTeX with HTML and MathML and nothing on top: no aria-label or role="math", so NVDA with MathCAT can
// navigate the formula and send it to braille. The Spanish reading goes in a separate audio button.
// display: a formula on its own line ($$…$$), centered and scrolling sideways if it doesn't fit.
export function Tex({ latex, display = false }: { latex: string; display?: boolean }) {
  const html = katex.renderToString(latex, { throwOnError: false, output: "htmlAndMathml", displayMode: display });
  if (display) return <div className="my-3 overflow-x-auto overflow-y-hidden" dangerouslySetInnerHTML={{ __html: html }} />;
  return <span className="mx-0.5 inline-block align-middle" dangerouslySetInnerHTML={{ __html: html }} />;
}
