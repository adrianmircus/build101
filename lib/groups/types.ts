import type { AssessmentType, Change } from "@/lib/contract";
import type { ProfileId } from "@/lib/profiles";

export type Student = {
  id: string;
  name: string;
  profiles: ProfileId[];
};

export type Group = {
  id: string;
  name: string;
  students: Student[];
};

export type VersionStatus = "pending" | "generating" | "ready" | "error";

// One version for each combination of profiles present in the group.
export type Version = {
  profiles: ProfileId[];
  studentIds: string[];
  status: VersionStatus;
  content?: string;
  changes?: Change[];
  approved: boolean;
};

export type Assessment = {
  id: string;
  groupId: string;
  type: AssessmentType;
  topic: string;
  original: string;
  versions: Version[];
  createdAt: string;
};

export type Data = {
  groups: Group[];
  assessments: Assessment[];
};
