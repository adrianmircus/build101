import { z } from "zod";
import { Id, Key, Revision, Timestamp } from "../common";
import { AnswerMode, GraphSpec, OptionId, OptionList } from "../assessments/versions";

// Publications, attempts, submissions and grades (20261111130700_delivery.sql). What a student
// receives is an immutable copy; answers and grading point to exercise and question ids.

export const ATTEMPT_STATUSES = ["opened", "started", "submitted"] as const;
export const AttemptStatus = z.enum(ATTEMPT_STATUSES);
export type AttemptStatus = z.infer<typeof AttemptStatus>;

export const ASSIGNMENT_STATUSES = ["assigned", "in_progress", "submitted", "graded", "withdrawn"] as const;
export const AssignmentStatus = z.enum(ASSIGNMENT_STATUSES);

/** Computed by the server, never named after a profile. */
export const Aids = z.object({ readAloud: z.boolean() }).strict();
export type Aids = z.infer<typeof Aids>;

export const PublishedExercise = z.object({ id: Id, label: z.string(), body: z.string() }).strict();

/** A gaze question as published: the options, never which one is right. */
export const PublishedQuestion = z
  .object({ id: Id, exerciseId: Id, stem: z.string(), options: OptionList })
  .strict();

export const PublicationContent = z
  .object({
    generalInstructions: z.string(),
    exercises: z.array(PublishedExercise),
    questions: z.array(PublishedQuestion),
  })
  .strict();
export type PublicationContent = z.infer<typeof PublicationContent>;

export const Publication = z
  .object({
    id: Id,
    assessmentId: Id,
    versionId: Id,
    versionRevision: Revision,
    answerKeyRevisionId: Id.nullable(),
    content: PublicationContent,
    answerMode: AnswerMode,
    aids: Aids,
    publishedAt: Timestamp,
    withdrawnAt: Timestamp.nullable(),
  })
  .strict();
export type Publication = z.infer<typeof Publication>;

/** One answer. voice: dictated; text is what the student confirmed, transcript what was heard. */
export const Answer = z
  .object({
    text: z.string().max(20000),
    mode: z.enum(["typed", "voice"]),
    transcript: z.string().max(20000).optional(),
    graph: GraphSpec.optional(),
  })
  .strict();
export type Answer = z.infer<typeof Answer>;

export const Answers = z.record(Id, Answer);
export const Choices = z.record(Id, OptionId);

export const Draft = z.object({ revision: Revision, answers: Answers, choices: Choices }).strict();
export type Draft = z.infer<typeof Draft>;

export const EXERCISE_RESULT_STATUSES = ["correct", "partial", "wrong", "blank"] as const;
export const ExerciseResultStatus = z.enum(EXERCISE_RESULT_STATUSES);

/** errors are ids of the error catalogue of the subject: for the teacher, not for the student. */
export const ExerciseResult = z.object({ status: ExerciseResultStatus, errors: z.array(Key).max(20) }).strict();

/** Today's scale (lib/groups/grades.ts): a whole number from 1 to 10. */
export const Score = z.int().min(1).max(10);

export const Grade = z
  .object({
    score: Score.nullable(),
    feedback: z.string().max(5000),
    exerciseResults: z.record(Id, ExerciseResult),
    gradedBy: Id.nullable(),
    gradedAt: Timestamp.nullable(),
    revision: Revision,
  })
  .strict();
export type Grade = z.infer<typeof Grade>;

export const FEEDBACK_EVENT_KINDS = ["opened", "started", "submitted", "exercise_time", "aid_used", "student_feedback"] as const;

/** Learning-engine raw material, by pseudonym only (written from phase 8). */
export const FeedbackEvent = z
  .object({
    id: Id,
    pseudonymId: Id,
    kind: z.enum(FEEDBACK_EVENT_KINDS),
    publicationId: Id.nullable(),
    exerciseId: Id.nullable(),
    data: z.record(z.string(), z.unknown()),
    occurredAt: Timestamp,
  })
  .strict();
export type FeedbackEvent = z.infer<typeof FeedbackEvent>;
