"use client";

import "katex/dist/katex.min.css";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

// Shows exercises the way the agent writes them (markdown + LaTeX): tables with borders and drawn formulas.
// Raw HTML in the text is not rendered (no rehype-raw). A badly written formula shows in red instead of breaking the page.

const REHYPE: Options["rehypePlugins"] = [[rehypeKatex, { throwOnError: false }]];

const BLOCK: Components = {
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="border-collapse border-2 border-slate-400">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-2 border-slate-400 bg-slate-100 px-4 py-2 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="min-w-16 border-2 border-slate-400 px-4 py-2">{children}</td>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-6">{children}</ol>,
};

// Short texts (an option, a confirmation): no paragraph around them.
const INLINE: Components = { ...BLOCK, p: ({ children }) => <>{children}</> };

// The agent writes one idea per line (an exercise, its sub-items, "Preguntas guía:" and each question), but markdown
// joins single line breaks into one paragraph. Each line becomes its own paragraph, except table rows and the lines
// of a multi-line $$ formula, which have to stay together.
function lineParagraphs(text: string): string {
  const out: string[] = [];
  let inDisplay = false;
  for (const line of text.split("\n")) {
    const previous = out.at(-1);
    const keepTogether = inDisplay || (line.trim().startsWith("|") && previous?.trim().startsWith("|"));
    out.push(previous === undefined || keepTogether || !line.trim() || !previous.trim() ? line : `\n${line}`);
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inDisplay = !inDisplay;
  }
  return out.join("\n");
}

// The agent sometimes writes an amount of money as a formula ("$\$150$"). Markdown reads the "\$" as an escaped
// dollar before remark-math sees it, and it shows up as "\150$". An amount alone is plain text: "\$150" shows "$150".
function moneyAsText(text: string): string {
  return text.replace(/\$\\\$\s*([\d.,]+)\s*\$/g, "\\$$$1");
}

export function MathText({ text, inline = false, className = "" }: { text: string; inline?: boolean; className?: string }) {
  const source = moneyAsText(text);
  const markdown = (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={REHYPE} components={inline ? INLINE : BLOCK}>
      {inline ? source : lineParagraphs(source)}
    </ReactMarkdown>
  );
  return inline ? <span className={className}>{markdown}</span> : <div className={`space-y-3 ${className}`}>{markdown}</div>;
}
