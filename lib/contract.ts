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

// Multiple choice for students who answer with eye gaze (profile "motor"): one option per screen quadrant.
export type OptionId = "A" | "B" | "C" | "D";

export type Question = {
  exercise: number; // number of the exercise in the original (1, 2, …)
  stem: string; // self-contained statement, markdown + LaTeX
  options: { id: OptionId; text: string }[]; // 2 to 4
  answer: OptionId; // answer key: for the teacher only, never shown to the student
};

export type GenerationResponse = {
  profiles: ProfileId[];
  content: string; // markdown + LaTeX
  changes: Change[];
  questions?: Question[]; // only when the version includes the "motor" profile
};

// POST /api/answers/transcribe: a student with writing difficulties dictates an answer and the agent
// writes it in math notation, without correcting it. The student confirms it before it's saved.
// Only the exercise and what the browser heard travel: never names or profiles.
export type TranscribeRequest = {
  exercise: string; // statement of the exercise, for context
  transcript: string; // what the student said, as the browser heard it
};

export type TranscribeResponse = {
  answer: string; // the answer in readable notation (Unicode: x², √, ·, −), exactly what was said
  readback: string; // how the answer reads aloud, so the student can confirm it by ear
  doubts: string[]; // what could be read two ways, as questions for the student; empty if none
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
