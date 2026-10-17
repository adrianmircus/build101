import type { AssessmentType } from "@/lib/contract";
import { profileLabel, sortProfiles, type ProfileId } from "@/lib/profiles";
import type { Student } from "./types";

export const TYPE_LABEL: Record<AssessmentType, string> = {
  worksheet: "Práctico",
  exam: "Parcial",
};

export type VersionGroup = {
  profiles: ProfileId[];
  studentIds: string[];
};

// Groups students by combination of profiles: 28 students can be just 4 versions.
// The unadapted version goes first, then the single-profile ones and the combined ones last.
export function groupByProfiles(students: Student[]): VersionGroup[] {
  const byKey = new Map<string, VersionGroup>();
  for (const s of students) {
    const profiles = sortProfiles(s.profiles);
    const key = profiles.join("+");
    const group = byKey.get(key) ?? { profiles, studentIds: [] };
    group.studentIds.push(s.id);
    byKey.set(key, group);
  }
  return [...byKey.values()].sort(
    (a, b) => a.profiles.length - b.profiles.length || a.profiles.join("+").localeCompare(b.profiles.join("+")),
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

export function versionLabel(profiles: ProfileId[]): string {
  return profiles.length === 0 ? "Sin adaptación" : profiles.map(profileLabel).join(" + ");
}
