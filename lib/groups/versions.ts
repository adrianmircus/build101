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

export function versionLabel(profiles: ProfileId[]): string {
  return profiles.length === 0 ? "Sin adaptación" : profiles.map(profileLabel).join(" + ");
}
