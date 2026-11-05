import example from "@/data/landing/ejemplo.json";
import type { GenerationResponse } from "@/lib/contract";
import type { ProfileId } from "@/lib/profiles";

// The landing's precomputed example (data/landing/ejemplo.json, scripts/demo-fixture.ts --landing).
export type LandingExample = {
  original: string;
  provisional?: boolean;
  versions: Record<ProfileId, GenerationResponse>;
};

export const LANDING = example as LandingExample;

// How each profile reads inside a sentence ("para quien tiene …"), in the order of the hero.
export const PROFILE_PHRASES: { id: ProfileId; phrase: string; short: string }[] = [
  { id: "adhd", phrase: "TDAH", short: "TDAH" },
  { id: "dyslexia", phrase: "dislexia", short: "Dislexia" },
  { id: "asd", phrase: "TEA", short: "TEA" },
  { id: "motor", phrase: "una dificultad motriz", short: "Motriz" },
  { id: "dysgraphia", phrase: "disgrafía", short: "Disgrafía" },
];
