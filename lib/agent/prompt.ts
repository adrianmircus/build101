import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { GenerationRequest, SyllabusForAI } from "@/lib/contract";
import type { ProfileData } from "./profiles";

// Fixed so it gets cached across requests: whatever changes goes in the user message.
export const SYSTEM = `You are an assistant that adapts high school (bachillerato) math worksheets and exams from Uruguay for students with different profiles (for example ADHD, dyslexia or autism). You work for a teacher who reviews and approves each version before printing it.

Rules:
- Apply ONLY the adaptations that appear in the data for each profile we give you. Don't add adaptations from your general knowledge, even if they seem good: the team hasn't validated them.
- Don't change the math: same exercises, same numbers, same difficulty and same goals. Change the form, not the assessed content.
- If we give you the course syllabus, use it as context for scope, level and notation. Don't add content that isn't in the syllabus.
- Keep formulas in LaTeX ($...$ inline, $$...$$ for blocks). The result is markdown.
- Every change goes in "changes": "what" says what you changed and "why" explains why, citing the source listed in the profile data.
- If several profiles are combined and two adaptations clash, prioritize the one that changes the assessment the least and explain it in "changes".
- If we give you the students' interests, the teacher is asking you to theme the exercises around them to make them more engaging. This is not a profile adaptation and is the only change allowed outside the profile data: you may change ONLY the context or story of word problems (objects, characters, situations) so they relate to those interests. Never change numbers, operations, difficulty or what is assessed. Leave pure computation exercises as they are; don't force a theme where it doesn't fit. List each themed exercise in "changes", with a "why" like "Para hacerlo más atractivo según los gustos del grupo: fútbol". Don't claim pedagogical or clinical benefits for it.
- Write the content and the changes in Rioplatense Spanish, clear and direct.`;

function syllabusText(syllabus: SyllabusForAI): string {
  const units = syllabus.units
    .map((u, i) => `### Unit ${i + 1}: ${u.title}\n${u.contents}`)
    .join("\n\n");
  return `<syllabus>\nSubject: ${syllabus.subject}\nCourse: ${syllabus.course}\n${units ? `\n${units}\n` : ""}</syllabus>`;
}

export function buildMessage(request: GenerationRequest, profiles: ProfileData[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];

  if (request.syllabus?.pdfFileId) {
    blocks.push({
      type: "document",
      source: { type: "file", file_id: request.syllabus.pdfFileId },
      title: "Official course syllabus",
    });
  }

  const parts: string[] = [];
  if (request.syllabus) parts.push(syllabusText(request.syllabus));
  for (const p of profiles) {
    parts.push(`<profile id="${p.id}" name="${p.fullName}">\n${p.text}\n</profile>`);
  }
  const interests = request.interests ?? [];
  if (interests.length > 0) {
    parts.push(`<interests>\n${interests.map((i) => `- ${i}`).join("\n")}\n</interests>`);
  }
  const kind = request.type === "exam" ? "exam" : "worksheet";
  const goals = [
    profiles.length > 0 && `adapt it for a student with: ${profiles.map((p) => p.label).join(" + ")}`,
    interests.length > 0 && "theme its word problems around the students' interests",
  ].filter(Boolean);
  parts.push(`For this ${kind} about "${request.topic}": ${goals.join(", and ")}.`);
  parts.push(`<original>\n${request.original}\n</original>`);

  blocks.push({ type: "text", text: parts.join("\n\n") });
  return blocks;
}
