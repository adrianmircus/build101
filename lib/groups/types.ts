import type { AssessmentType, Change, OptionId, Question } from "@/lib/contract";
import type { ProfileId } from "@/lib/profiles";

export type Student = {
  id: string;
  name: string;
  profiles: ProfileId[];
  // Additional data the teacher loads. Optional so older localStorage data keeps working.
  interests?: string[];
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
  // Interests the version is themed around, fixed when it was created (empty or missing: none).
  interests?: string[];
  status: VersionStatus;
  content?: string;
  changes?: Change[];
  // Multiple choice to answer with eye gaze, only for versions with the "motor" profile.
  questions?: Question[];
  approved: boolean;
};

// A student's result on an assessment, on the 1–10 scale (see lib/groups/grades.ts).
export type Grade = {
  score: number;
  feedback?: string;
  gradedAt: string;
};

export type ExerciseStatus = "correct" | "partial" | "wrong" | "blank";

// How a student did on one exercise. errors are ids from ERROR_TAGS (lib/results/catalog.ts).
export type ExerciseResult = {
  status: ExerciseStatus;
  errors: string[];
};

// A student's answer to one exercise. "voice": dictated, and text is what the student confirmed
// after the AI turned the dictation into notation; transcript is what the browser heard, as-is.
export type Answer = {
  text: string;
  mode: "typed" | "voice";
  transcript?: string;
};

// What a student solves on the platform. Once submittedAt is set it can't change.
export type Submission = {
  // By exercise index (its number in the original − 1), the same as exerciseResults.
  answers: (Answer | null)[];
  // By question index, only for versions with multiple choice (eye gaze).
  choices?: (OptionId | null)[];
  submittedAt?: string;
};

export type Assessment = {
  id: string;
  groupId: string;
  type: AssessmentType;
  topic: string;
  original: string;
  versions: Version[];
  // By student id. Optional so older localStorage data keeps working.
  grades?: Record<string, Grade>;
  // Per-exercise correction. The count defaults to the exercises detected in the original.
  exerciseCount?: number;
  // By student id, one entry per exercise; null means not marked yet.
  exerciseResults?: Record<string, (ExerciseResult | null)[]>;
  // By student id. Optional so older localStorage data keeps working.
  submissions?: Record<string, Submission>;
  createdAt: string;
};

// The AI's reading of a group's results. A draft for the teacher, never shown to students.
export type GroupAnalysis = {
  summary: string;
  difficulties: { topic: string; evidence: string }[];
  students: { studentId: string; summary: string }[];
  createdAt: string;
};

export type Data = {
  groups: Group[];
  assessments: Assessment[];
  // By group id. Optional so older localStorage data keeps working.
  analyses?: Record<string, GroupAnalysis>;
};
