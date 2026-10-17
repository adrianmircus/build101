import type { AssessmentType } from "@/lib/contract";
import { profileLabel, sortProfiles, type ProfileId } from "@/lib/profiles";
import { sortSupports, type Support } from "@/lib/supports";
import type { Student } from "./types";

export const TYPE_LABEL: Record<AssessmentType, string> = {
  worksheet: "Práctico",
  exam: "Parcial",
};

export type VersionGroup = {
  profiles: ProfileId[];
  supports: Support[];
  studentIds: string[];
};

const keyOf = (v: { profiles: ProfileId[]; supports: Support[] }) => [...v.profiles, ...v.supports].join("+");

// Groups students by combination of profiles and reasoning supports: 28 students can be just 4 versions.
// The unadapted version goes first, then the single-profile ones, the combined ones, and those with supports last.
export function groupByProfiles(students: Student[]): VersionGroup[] {
  const byKey = new Map<string, VersionGroup>();
  for (const s of students) {
    const version = { profiles: sortProfiles(s.profiles), supports: sortSupports(s.supports) };
    const group = byKey.get(keyOf(version)) ?? { ...version, studentIds: [] };
    group.studentIds.push(s.id);
    byKey.set(keyOf(version), group);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      Number(a.supports.length > 0) - Number(b.supports.length > 0) ||
      a.profiles.length - b.profiles.length ||
      keyOf(a).localeCompare(keyOf(b)),
  );
}

export function normalizeInterest(interest: string): string {
  return interest.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

// The most common interests among the given students; ties go alphabetically.
export function topInterests(students: Student[], max = 3): string[] {
  const counts = new Map<string, number>();
  for (const s of students) {
    for (const interest of new Set((s.interests ?? []).map(normalizeInterest))) {
      if (interest) counts.set(interest, (counts.get(interest) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b, "es"))
    .slice(0, max)
    .map(([interest]) => interest);
}

export function versionLabel(profiles: ProfileId[], supports: readonly Support[] = []): string {
  const parts = [...profiles.map(profileLabel), ...(supports.length > 0 ? ["Razonamiento disminuido"] : [])];
  return parts.length === 0 ? "Sin adaptación" : parts.join(" + ");
}
