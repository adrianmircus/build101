import { z } from "zod";
import { DisplayName, Id, ReasonCode, Revision, Timestamp } from "../common";
import { Interest, ProfileId, SupportId } from "../students/needs";

// Versions and what hangs from them (20261111130500_assessments_versions.sql). Sensitive:
// the config, the answer mode and the recipients (together they reveal profiles), and the
// changes with their reasons. None of this reaches a student DTO.

export const ANSWER_MODES = ["typed", "gaze", "voice"] as const;
export const AnswerMode = z.enum(ANSWER_MODES);
export type AnswerMode = z.infer<typeof AnswerMode>;

export const VERSION_STATUSES = ["empty", "generating", "ready", "error"] as const;
export const VERSION_EXERCISE_STATUSES = ["pending", "generating", "ready", "error"] as const;

/** Sensitive. What the version adapts to; keep lists the original exercise ids it keeps. */
export const VersionConfig = z
  .object({
    profiles: z.array(ProfileId).max(10),
    supports: z.array(SupportId).max(10),
    interests: z.array(Interest).max(5),
    keep: z.array(Id).optional(),
  })
  .strict();
export type VersionConfig = z.infer<typeof VersionConfig>;

/** A graph the platform draws; the AI only describes it. */
export const GraphSpec = z
  .object({
    functions: z.array(z.object({ expr: z.string().max(200), label: z.string().max(60).optional() }).strict()).max(5),
    points: z.array(z.object({ x: z.number(), y: z.number(), label: z.string().max(60).optional() }).strict()).max(20),
    window: z.object({ xMin: z.number(), xMax: z.number(), yMin: z.number(), yMax: z.number() }).strict().optional(),
  })
  .strict();
export type GraphSpec = z.infer<typeof GraphSpec>;

export const OptionId = z.string().regex(/^[A-Z]$/);

export const QuestionOption = z
  .object({ id: OptionId, text: z.string().max(2000), graph: GraphSpec.optional() })
  .strict();

/** 2 to 4 options with distinct ids, like app.is_option_list: [A, A] could never be graded. */
export const OptionList = z
  .array(QuestionOption)
  .min(2)
  .max(4)
  .refine((options) => new Set(options.map((option) => option.id)).size === options.length, {
    message: "Hay opciones repetidas.",
  });

/** For the teacher only: what changed and why. The why can name the profile. */
export const Change = z.object({ what: z.string().max(500), why: z.string().max(1000) }).strict();

export const Version = z
  .object({
    id: Id,
    assessmentId: Id,
    position: z.int().min(1),
    baseVersionId: Id.nullable(),
    // The version's own copy: approved and published with the rest of its content.
    generalInstructions: z.string().max(5000),
    instructionsRevision: Revision,
    config: VersionConfig,
    answerMode: AnswerMode,
    status: z.enum(VERSION_STATUSES),
    stale: z.boolean(),
    errorCode: ReasonCode.nullable(),
    currentGenerationId: Id.nullable(),
    approvedRevision: Revision.nullable(),
    revision: Revision,
  })
  .strict();
export type Version = z.infer<typeof Version>;

export const VersionExercise = z
  .object({
    id: Id,
    exerciseId: Id,
    sourceRevision: Revision,
    body: z.string().max(20000),
    changes: z.array(Change).max(20),
    status: z.enum(VERSION_EXERCISE_STATUSES),
    errorCode: ReasonCode.nullable(),
    currentGenerationId: Id.nullable(),
    revision: Revision,
  })
  .strict();
export type VersionExercise = z.infer<typeof VersionExercise>;

export const VersionQuestion = z
  .object({
    id: Id,
    versionExerciseId: Id,
    position: z.int().min(0),
    stem: z.string().min(1).max(5000),
    options: OptionList,
    revision: Revision,
  })
  .strict();
export type VersionQuestion = z.infer<typeof VersionQuestion>;

export const QuestionKey = z.object({ questionId: Id, correctOptionId: OptionId, revision: Revision }).strict();
export type QuestionKey = z.infer<typeof QuestionKey>;

/** Sensitive. Who the version is for, with the name only staff may see. */
export const VersionRecipient = z
  .object({ studentId: Id, displayName: DisplayName, validFrom: Timestamp })
  .strict();
export type VersionRecipient = z.infer<typeof VersionRecipient>;
