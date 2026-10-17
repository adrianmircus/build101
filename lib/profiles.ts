// Adaptation profiles. They are data: adding a new one (for example, motor
// difficulties) means adding an entry here, without touching the screens.
export type ProfileId = string;

export type Profile = {
  id: ProfileId;
  label: string;
  fullName: string;
};

export const PROFILES: Profile[] = [
  { id: "adhd", label: "TDAH", fullName: "Trastorno por déficit de atención e hiperactividad" },
  { id: "dyslexia", label: "Dislexia", fullName: "Dislexia" },
  { id: "asd", label: "TEA", fullName: "Trastorno del espectro autista" },
  { id: "motor", label: "Motriz", fullName: "Discapacidad motriz: responde con la mirada" },
  { id: "dysgraphia", label: "Disgrafía", fullName: "Dificultades de escritura: responde dictando" },
];

// Students with this profile can't write: their version also comes as multiple choice to answer with eye gaze.
export const GAZE_PROFILE: ProfileId = "motor";

export function usesGaze(profiles: ProfileId[]): boolean {
  return profiles.includes(GAZE_PROFILE);
}

// Students with this profile have trouble writing: they answer by dictating, and confirm what the AI understood.
export const VOICE_PROFILE: ProfileId = "dysgraphia";

export function usesVoice(profiles: ProfileId[]): boolean {
  return profiles.includes(VOICE_PROFILE);
}

export function profileLabel(id: ProfileId): string {
  return PROFILES.find((p) => p.id === id)?.label ?? id;
}

// Stable order (the one in PROFILES) so "ADHD + Dyslexia" and "Dyslexia + ADHD" are the same combination.
export function sortProfiles(profiles: ProfileId[]): ProfileId[] {
  const position = (id: ProfileId) => {
    const i = PROFILES.findIndex((p) => p.id === id);
    return i === -1 ? PROFILES.length : i;
  };
  return [...new Set(profiles)].sort((a, b) => position(a) - position(b) || a.localeCompare(b));
}
