import type { AssessmentType } from "@/lib/contract";
import type { ProfileId } from "@/lib/profiles";
import type { Support } from "@/lib/supports";

// The worksheet the landing's hero adapts in front of the visitor (docs/LANDING.md, "Ejemplo de la landing").
// A word problem with a graphing item, so every profile shows something of its own without bending its rules.
// Its versions come precomputed (data/landing/ejemplo.json): the landing never calls the AI.
export const LANDING_EXAMPLE: { type: AssessmentType; topic: string; original: string } = {
  type: "worksheet",
  topic: "Función cuadrática",
  original: [
    "1) Una pelota se lanza hacia arriba desde el piso. Su altura, en metros, es $h(t) = -5t^2 + 20t$, donde $t$ es el tiempo en segundos desde el lanzamiento.",
    "a) ¿Cuál es la altura máxima que alcanza la pelota?",
    "b) ¿En qué momento vuelve a tocar el piso?",
    "c) Graficá $h$.",
  ].join("\n"),
};

// One version per profile on its own, in the order of the hero's chips.
export const LANDING_PROFILES: ProfileId[] = ["adhd", "dyslexia", "asd", "motor", "dysgraphia"];

// None: the problem already has its context, and supports are a teacher's call for a specific student.
// Whatever is used here is recorded in the fixture so the run can be reproduced.
export const LANDING_INTERESTS: string[] = [];
export const LANDING_SUPPORTS: Support[] = [];
