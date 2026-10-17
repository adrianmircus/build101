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
  syllabus?: SyllabusForAI;
};

export type SyllabusPdfResponse = {
  fileId: string;
  name: string;
};

export type GenerationResponse = {
  profiles: ProfileId[];
  content: string; // markdown + LaTeX
  changes: Change[];
};
