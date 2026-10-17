// An exercise of a version with reasoning supports, split into what the student can listen to one by one: the
// statement and each support. The headings are the ones the prompt asks for (lib/agent/prompt.ts). Without AI.
export type SupportParts = {
  statement: string;
  guide: string[];
  reminder: string | null;
  example: string | null;
};

type Section = "statement" | "guide" | "reminder" | "example";

// "**Preguntas guía:**", "Recordatorio:", "**Ejemplo resuelto**: …" — with or without bold, text on the same line or not.
const HEADING = /^\s*(?:\*\*|__)?\s*(preguntas gu[ií]a|recordatorio|ejemplo resuelto)\s*:?\s*(?:\*\*|__)?\s*:?\s*(.*)$/i;

function sectionOf(title: string): Section {
  const t = title.toLowerCase();
  return t.startsWith("pregunta") ? "guide" : t.startsWith("record") ? "reminder" : "example";
}

export function splitSupports(text: string): SupportParts {
  const lines: Record<Section, string[]> = { statement: [], guide: [], reminder: [], example: [] };
  let section: Section = "statement";
  for (const line of text.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      section = sectionOf(heading[1]);
      if (heading[2].trim()) lines[section].push(heading[2].trim());
    } else if (line.trim()) {
      lines[section].push(line.trim());
    }
  }
  const joined = (s: Section) => (lines[s].length > 0 ? lines[s].join("\n") : null);
  return {
    statement: lines.statement.join("\n"),
    // Each guiding question is a line; list markers ("- ", "1. ") don't go to the audio.
    guide: lines.guide.map((g) => g.replace(/^(?:[-•*]|\d+[.)])\s+/, "")).filter(Boolean),
    reminder: joined("reminder"),
    example: joined("example"),
  };
}

export function hasSupports(parts: SupportParts): boolean {
  return parts.guide.length > 0 || parts.reminder !== null || parts.example !== null;
}
