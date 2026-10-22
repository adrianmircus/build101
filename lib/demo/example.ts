import type { AssessmentType } from "@/lib/contract";

// The worksheet the demo's tour uses, for "Grupo demo". Its versions come precomputed (data/demo/limites.json):
// in the demo nothing calls the AI.
export const DEMO_GROUP_ID = "demo";

export const DEMO_EXAMPLE: { type: AssessmentType; topic: string; original: string } = {
  type: "worksheet",
  topic: "Límites de funciones",
  original: [
    "1) Calculá $\\lim_{x \\to 2} (3x - 1)$.",
    "2) Calculá $\\lim_{x \\to 2} \\dfrac{x^2 - 4}{x - 2}$.",
    "3) Calculá $\\lim_{x \\to +\\infty} \\dfrac{2x + 1}{x - 3}$.",
  ].join("\n"),
};
