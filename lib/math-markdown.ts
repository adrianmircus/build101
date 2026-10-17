// The little Markdown the agent writes in its versions (lib/agent/prompt.ts): lines, **bold**, "# titles",
// "- items" and LaTeX ($…$ inline, $$…$$ in a block, also \(…\) and \[…\]). Anything else stays as text.
// Pure, so the tests in scripts/adapter can run it without React; components/ui/MathMarkdown renders it.

export type Inline = { kind: "text" | "math"; value: string; bold: boolean };
export type Block =
  | { kind: "math"; tex: string }
  | { kind: "line"; heading: boolean; bullet: boolean; inlines: Inline[] }
  | { kind: "blank" };

const DISPLAY = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g;
// Inline math needs no space right inside the $ and no digit after the closing one, so "$150 y $200"
// (pesos) stays as text.
const INLINE = /(\\\([\s\S]+?\\\)|\$(?!\s)(?:\\\$|[^$\n])+?(?<!\s)\$(?!\d)|\*\*)/g;

export function parseMathMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let at = 0;
  for (const match of text.matchAll(DISPLAY)) {
    blocks.push(...lines(text.slice(at, match.index)));
    blocks.push({ kind: "math", tex: (match[1] ?? match[2]).trim() });
    at = match.index + match[0].length;
  }
  blocks.push(...lines(text.slice(at)));
  // Line breaks around a $$ block aren't blank lines of their own.
  while (blocks[0]?.kind === "blank") blocks.shift();
  while (blocks.at(-1)?.kind === "blank") blocks.pop();
  return blocks;
}

function lines(text: string): Block[] {
  const parts = text.split(/\r?\n/);
  // A $$ block in the middle of a line leaves an empty piece on each side, not a blank line.
  if (parts.length > 1 && !parts[0].trim()) parts.shift();
  if (parts.length > 1 && !parts.at(-1)!.trim()) parts.pop();
  return parts.map((raw): Block => {
    // A separator line ("---") reads as a pause, like a blank line.
    if (!raw.trim() || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) return { kind: "blank" };
    const heading = /^\s*#{1,6}\s+/.exec(raw);
    const bullet = heading ? null : /^\s*[-*]\s+/.exec(raw);
    const rest = raw.slice((heading ?? bullet)?.[0].length ?? 0).trim();
    return { kind: "line", heading: Boolean(heading), bullet: Boolean(bullet), inlines: inlines(rest) };
  });
}

function inlines(line: string): Inline[] {
  // split with a capture group alternates: text, match, text, match…
  const tokens = line.split(INLINE);
  // An unpaired ** is shown as is.
  let marks = tokens.filter((t, i) => i % 2 === 1 && t === "**").length;
  let bold = false;
  const out: Inline[] = [];
  const push = (kind: Inline["kind"], value: string) => {
    if (!value) return;
    const prev = out.at(-1);
    if (kind === "text" && prev?.kind === "text" && prev.bold === bold) prev.value += value;
    else out.push({ kind, value, bold });
  };
  tokens.forEach((token, i) => {
    if (i % 2 === 0) push("text", token);
    else if (token !== "**") push("math", token.startsWith("$") ? token.slice(1, -1) : token.slice(2, -2).trim());
    else if (bold || marks >= 2) {
      bold = !bold;
      marks--;
    } else push("text", token);
  });
  return out;
}
