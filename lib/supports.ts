// Reasoning supports ("razonamiento disminuido") the teacher turns on for a student in "Datos adicionales".
// They lower the difficulty, so the version is marked.
export const SUPPORTS = ["preguntas_guia", "recordatorio", "ejemplo_resuelto", "numeros_simples"] as const;

export type Support = (typeof SUPPORTS)[number];

const LABELS: Record<Support, string> = {
  preguntas_guia: "Preguntas guía paso a paso",
  recordatorio: "Recordatorio del procedimiento",
  ejemplo_resuelto: "Ejemplo resuelto con otros números",
  numeros_simples: "Números más simples en los problemas",
};

export function supportLabel(support: Support): string {
  return LABELS[support];
}

export function isSupport(value: string): value is Support {
  return (SUPPORTS as readonly string[]).includes(value);
}

// Stable order (the one in SUPPORTS), no repeats, only known ones: two students with the same supports share a version.
export function sortSupports(supports: readonly string[] = []): Support[] {
  return SUPPORTS.filter((s) => supports.includes(s));
}
