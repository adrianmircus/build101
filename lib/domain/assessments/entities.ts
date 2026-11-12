import { z } from "zod";
import { Id, Revision, SubjectId, Timestamp } from "../common";

// Assessments and their original exercises (20261111130500_assessments_versions.sql). The original
// is general instructions plus a list of exercises with stable ids: answers, grading and events
// point to ids, never to positions.

export const ASSESSMENT_KINDS = ["worksheet", "exam"] as const;
export const AssessmentKind = z.enum(ASSESSMENT_KINDS);
export type AssessmentKind = z.infer<typeof AssessmentKind>;

export const ASSESSMENT_STATUSES = ["draft", "ready", "published", "archived"] as const;
export const AssessmentStatus = z.enum(ASSESSMENT_STATUSES);

export const Topic = z.string().trim().max(200);
/** What comes before the first exercise ("Elegí dos y justificá"). Never dropped. */
export const GeneralInstructions = z.string().max(5000);
export const ExerciseLabel = z.string().trim().min(1).max(20);
export const ExerciseBody = z.string().min(1).max(20000);

export const Assessment = z
  .object({
    id: Id,
    groupId: Id,
    subjectId: SubjectId,
    kind: AssessmentKind,
    topic: Topic,
    generalInstructions: GeneralInstructions,
    status: AssessmentStatus,
    publishAt: Timestamp.nullable(),
    dueAt: Timestamp.nullable(),
    sourceFileId: Id.nullable(),
    createdAt: Timestamp,
    revision: Revision,
  })
  .strict();
export type Assessment = z.infer<typeof Assessment>;

export const AssessmentExercise = z
  .object({
    id: Id,
    position: z.int().min(0),
    label: ExerciseLabel,
    body: ExerciseBody,
    topicId: Id.nullable(),
    revision: Revision,
  })
  .strict();
export type AssessmentExercise = z.infer<typeof AssessmentExercise>;

export const FILE_PURPOSES = ["assessment_source", "syllabus", "consent_form", "specialist_report"] as const;
export const FILE_STATUSES = ["reserved", "ready", "rejected", "missing"] as const;
export const MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

/** A file in Storage. Path is always <institution_id>/<file_id>; only ready files are used. */
export const StoredFile = z
  .object({
    id: Id,
    bucket: z.enum(["uploads", "consents"]),
    purpose: z.enum(FILE_PURPOSES),
    groupId: Id.nullable(),
    studentId: Id.nullable(),
    sizeBytes: z.int().min(1).nullable(),
    mimeType: z.enum(MIME_TYPES),
    status: z.enum(FILE_STATUSES),
    revision: Revision,
  })
  .strict();
export type StoredFile = z.infer<typeof StoredFile>;
