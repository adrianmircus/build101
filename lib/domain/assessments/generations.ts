import { z } from "zod";
import { Id, ReasonCode, Revision, Timestamp } from "../common";

// Generations, operations, raw outputs, version events and answer keys
// (20261111130600_generations.sql). Terminal states never reopen.

export const GENERATION_KINDS = ["version", "exercise", "answer_key"] as const;
export const GenerationKind = z.enum(GENERATION_KINDS);
export type GenerationKind = z.infer<typeof GenerationKind>;

export const GENERATION_STATUSES = ["running", "done", "failed", "cancelled", "superseded"] as const;
export const GenerationStatus = z.enum(GENERATION_STATUSES);
export type GenerationStatus = z.infer<typeof GenerationStatus>;
export const TERMINAL_GENERATION_STATUSES = ["done", "failed", "cancelled", "superseded"] as const;

export const OPERATION_KINDS = ["read_document", "read_syllabus", "analyze_group"] as const;
export const OPERATION_STATUSES = ["running", "merging", "done", "failed", "cancelled"] as const;

export const OUTPUT_KINDS = ["exercise", "gaze_questions", "instructions", "answer_key"] as const;
export const OutputKind = z.enum(OUTPUT_KINDS);
export const OUTPUT_OUTCOMES = ["applied", "obsolete", "discarded"] as const;
export const OutputOutcome = z.enum(OUTPUT_OUTCOMES);

export const VERSION_EVENT_KINDS = [
  "generated",
  "edited",
  "approved",
  "rejected",
  "regenerated",
  "recipients_changed",
] as const;
export const VersionEventKind = z.enum(VERSION_EVENT_KINDS);

/** SHA-256 of the approved data/profiles/*.md a generation used. */
export const ProfilesHash = z.string().regex(/^[0-9a-f]{64}$/);
export const VersionTag = z.string().min(1).max(80);

export const Generation = z
  .object({
    id: Id,
    versionId: Id,
    kind: GenerationKind,
    targetExerciseId: Id.nullable(),
    targetRevision: Revision,
    status: GenerationStatus,
    errorCode: ReasonCode.nullable(),
    requiredJobs: z.int().min(0),
    createdAt: Timestamp,
    finishedAt: Timestamp.nullable(),
  })
  .strict();
export type Generation = z.infer<typeof Generation>;

export const VersionEvent = z
  .object({
    id: Id,
    kind: VersionEventKind,
    // The concrete operation and target that wrote it, and the result replayed on a repeat.
    operation: z.string().regex(/^[a-z][a-z0-9_]{2,62}$/),
    targetId: Id,
    result: z.record(z.string(), z.unknown()),
    generationId: Id.nullable(),
    versionExerciseId: Id.nullable(),
    versionRevision: Revision,
    exerciseRevision: Revision.nullable(),
    data: z.record(z.string(), z.unknown()),
    actorUserId: Id.nullable(),
    createdAt: Timestamp,
  })
  .strict();
export type VersionEvent = z.infer<typeof VersionEvent>;

export const ANSWER_KEY_STATUSES = ["empty", "generating", "ready", "error"] as const;
export const ANSWER_KEY_SOURCES = ["generated", "edited", "confirmed"] as const;

/** Per adapted exercise the expected answer or rubric; per gaze question the correct option. */
export const AnswerKeyContent = z
  .object({
    exercises: z.record(Id, z.object({ answer: z.string().max(5000), rubric: z.string().max(5000).optional() }).strict()),
    questions: z.record(Id, z.string().regex(/^[A-Z]$/)),
  })
  .strict();
export type AnswerKeyContent = z.infer<typeof AnswerKeyContent>;

/**
 * Immutable. Keeps the snapshot it was made for: the version revision, the revision of every
 * adapted exercise and gaze question, and the instructions revision. It corresponds to a version
 * when both maps and the instructions revision equal today's.
 */
export const AnswerKeyRevision = z
  .object({
    id: Id,
    number: z.int().min(1),
    source: z.enum(ANSWER_KEY_SOURCES),
    content: AnswerKeyContent,
    versionRevision: Revision,
    exerciseRevisions: z.record(Id, Revision),
    questionRevisions: z.record(Id, Revision),
    instructionsRevision: Revision,
    createdAt: Timestamp,
  })
  .strict();
export type AnswerKeyRevision = z.infer<typeof AnswerKeyRevision>;

export const AnswerKey = z
  .object({
    id: Id,
    versionId: Id,
    status: z.enum(ANSWER_KEY_STATUSES),
    stale: z.boolean(),
    current: AnswerKeyRevision.nullable(),
    approvedRevisionId: Id.nullable(),
    revision: Revision,
  })
  .strict();
export type AnswerKey = z.infer<typeof AnswerKey>;
