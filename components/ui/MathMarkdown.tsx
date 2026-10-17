"use client";

import { Fragment } from "react";
import { Tex } from "@/components/adapter/MathText";
import { parseMathMarkdown, type Inline } from "@/lib/math-markdown";

// The text of a version or an exercise as the agent writes it: Markdown with **bold** and LaTeX formulas.
// The formulas go through KaTeX like in the adapter, with MathML and no aria-label on top (see Tex).
// inline: for short pieces inside a sentence or a button (multiple choice options), all in one line.
export function MathMarkdown({ text, className = "", inline = false }: { text: string; className?: string; inline?: boolean }) {
  const blocks = parseMathMarkdown(text);
  if (inline) {
    return (
      <span className={className}>
        {blocks.map((b, i) => (
          <Fragment key={i}>
            {i > 0 && " "}
            {b.kind === "math" ? <Tex latex={b.tex} /> : b.kind === "line" ? <Inlines inlines={b.inlines} /> : null}
          </Fragment>
        ))}
      </span>
    );
  }
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        if (b.kind === "math") return <Tex key={i} latex={b.tex} display />;
        if (b.kind === "blank") return <div key={i} aria-hidden="true" className="h-3" />;
        return (
          <p key={i} className={b.heading ? "font-bold" : undefined}>
            {b.bullet && <span aria-hidden="true">• </span>}
            <Inlines inlines={b.inlines} />
          </p>
        );
      })}
    </div>
  );
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return inlines.map((part, i) => {
    const content = part.kind === "math" ? <Tex latex={part.value} /> : part.value;
    return part.bold ? <strong key={i}>{content}</strong> : <Fragment key={i}>{content}</Fragment>;
  });
}
