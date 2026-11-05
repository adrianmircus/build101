"use client";

import { FunctionGraph } from "@/components/ui/FunctionGraph";
import { MathMarkdown } from "@/components/ui/MathMarkdown";
import { MathText } from "@/components/ui/MathText";
import type { GenerationResponse } from "@/lib/contract";

// What goes on the landing's sheet: the worksheet text, or for eye gaze its multiple choice, drawn as the student
// sees it (each option a filled block, graphs drawn). No borders: the blocks are told apart by their fill.
export function SheetContent({ text, version }: { text?: string; version?: GenerationResponse }) {
  if (version?.questions) {
    return (
      <div className="space-y-6">
        {version.questions.map((q, i) => (
          <div key={i}>
            <MathText text={q.stem} className="text-lg" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              {q.options.map((o) => (
                <div key={o.id} className="rounded-xl bg-slate-100 p-4">
                  <p className="text-lg font-medium">
                    {o.id}) <MathText text={o.text} inline />
                  </p>
                  {o.graph && (
                    <div className="mt-3">
                      <FunctionGraph spec={o.graph} size="sm" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  // The title line ("# Topic") stays out: the sheet already says what it is.
  const body = (version?.content ?? text ?? "").replace(/^#.*\n+/, "");
  return <MathMarkdown text={body} className="space-y-2 text-lg" />;
}
