import { ADJUSTMENT_LABELS, REASONING_ADJUSTMENTS } from "@/lib/adapter/adapt-schemas";

// Reasoning supports ("razonamiento disminuido") the teacher turns on for a student in "Datos adicionales".
// The same four as the adapter (lib/adapter/adapt-schemas.ts). They lower the difficulty, so the version is marked.
export type Support = (typeof REASONING_ADJUSTMENTS)[number];

export const SUPPORTS: readonly Support[] = REASONING_ADJUSTMENTS;

export function supportLabel(support: Support): string {
  return ADJUSTMENT_LABELS[support];
}

export function isSupport(value: string): value is Support {
  return (SUPPORTS as readonly string[]).includes(value);
}

// Stable order (the one in SUPPORTS), no repeats, only known ones: two students with the same supports share a version.
export function sortSupports(supports: readonly string[] = []): Support[] {
  return SUPPORTS.filter((s) => supports.includes(s));
}
