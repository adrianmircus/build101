// Why a teacher rejects a version: a closed list, without free text, so no student names slip in
// and the learning engine can count them. "prompt" is what the AI reads when it generates the version again.
export const REJECT_REASONS = [
  {
    id: "too_long",
    label: "Muy largo",
    prompt: "It was too long: make the statements and the adaptation more concise.",
  },
  {
    id: "difficulty_changed",
    label: "Cambió la dificultad",
    prompt: "It changed the difficulty: keep exactly the original's math, numbers and difficulty.",
  },
  {
    id: "math_error",
    label: "Error en los números o la matemática",
    prompt: "It had mistakes in the numbers or the math: check every number and calculation against the original.",
  },
  {
    id: "adaptation_wrong",
    label: "No aplica bien la adaptación",
    prompt: "It didn't apply the profile's adaptations well: follow the profile data more closely.",
  },
  {
    id: "context_unhelpful",
    label: "El contexto no le sirve",
    prompt: "The context or story of the problems didn't help: use a simpler, more familiar context, or none.",
  },
  {
    id: "missing_visual_support",
    label: "Le faltó apoyo visual",
    prompt: "It lacked visual support: use the visual supports the profile data allows (structure, tables, bold).",
  },
  {
    id: "other",
    label: "Otro",
    prompt: "The teacher gave no specific reason: try a different way of applying the same adaptations.",
  },
] as const;

export type RejectReasonId = (typeof REJECT_REASONS)[number]["id"];

export function isRejectReason(value: string): value is RejectReasonId {
  return REJECT_REASONS.some((r) => r.id === value);
}

export function rejectReasonPrompt(id: RejectReasonId): string {
  return REJECT_REASONS.find((r) => r.id === id)!.prompt;
}
