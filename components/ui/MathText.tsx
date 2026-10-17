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

export function MathText({ text, inline = false, className = "" }: { text: string; inline?: boolean; className?: string }) {
  const markdown = (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={REHYPE} components={inline ? INLINE : BLOCK}>
      {text}
    </ReactMarkdown>
  );
  return inline ? <span className={className}>{markdown}</span> : <div className={`space-y-3 ${className}`}>{markdown}</div>;
}
