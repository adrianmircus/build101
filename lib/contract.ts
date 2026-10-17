// Front ↔ agent contract. SHARED between Dev A and Dev B: changing it requires telling the other dev.
// Proposal: one call to POST /api/generate for each version of the assessment.
// Student names never travel: only the exercises and the combination of profiles.
import type { ProfileId } from "@/lib/profiles";

export type AssessmentType = "worksheet" | "exam";

export type Change = {
  what: string;
  why: string;
};

// Course syllabus the teacher loads in "Mi materia". The syllabus PDF is uploaded
// once to /api/syllabus/pdf and only its id travels here.
export type SyllabusUnit = {
  title: string;
  contents: string;
};

export type SyllabusForAI = {
  subject: string;
  course: string;
  units: SyllabusUnit[];
  pdfFileId?: string;
};

export type GenerationRequest = {
  type: AssessmentType;
  topic: string;
  original: string;
  profiles: ProfileId[];
  // Most common interests among the version's students (at most 5). Only the interests, never names.
  interests?: string[];
  syllabus?: SyllabusForAI;
};

export type SyllabusPdfResponse = {
  fileId: string;
  name: string;
};

// POST /api/syllabus/units: the agent reads the uploaded PDF and proposes one unit per section.
export type SyllabusUnitsRequest = {
  fileId: string;
};

export type SyllabusUnitsResponse = {
  units: SyllabusUnit[];
};

export type GenerationResponse = {
  profiles: ProfileId[];
  content: string; // markdown + LaTeX
  changes: Change[];
};

// POST /api/results/analyze: the agent reads a group's results and summarizes the difficulties.
// Students travel as pseudonyms ("E1", "E2"…): never names, profiles or the teacher's feedback.
export type ExerciseMark = {
  status: "correct" | "partial" | "wrong" | "blank";
  errors: string[]; // error type labels, e.g. "Interpretación del enunciado"
};

export type ResultsAnalysisRequest = {
  assessments: {
    type: AssessmentType;
    topic: string;
    exercises: string[]; // text of each exercise
    students: { ref: string; grade?: number; marks: (ExerciseMark | null)[] }[];
  }[];
};

export type ResultsAnalysisResponse = {
  summary: string;
  difficulties: { topic: string; evidence: string }[];
  students: { ref: string; summary: string }[];
};
