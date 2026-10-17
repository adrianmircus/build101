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
];

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
