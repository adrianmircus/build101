import { z } from "zod";
import { DisplayName, Id, Revision, type RpcSpec, Timestamp } from "../common";
import { AnswerKeyRevision } from "../assessments/generations";
import { Answers, AttemptStatus, Choices, ExerciseResult, Grade, Publication, Score } from "./entities";
import { StudentGrades, StudentHome, StudentTask, StudentTaskList } from "./student-dto";

// RPCs of delivery (20261111131200_rpc_delivery.sql): minimal publish (T1.5a), the attempt
// lifecycle (T1.5b), grading (T1.5c) and the student DTOs (T1.5d).

/** What the teacher sees per student, without saying which version each one got. */
export const AttemptRow = z
  .object({
    studentId: Id,
    displayName: DisplayName,
    assignmentId: Id,
    attemptId: Id.nullable(),
    status: AttemptStatus.nullable(),
    submittedAt: Timestamp.nullable(),
    late: z.boolean(),
    score: Score.nullable(),
    graded: z.boolean(),
  })
  .strict();
export type AttemptRow = z.infer<typeof AttemptRow>;

/** Audited: the adapted content the student solved can reveal the adaptation. */
export const AttemptForGrading = z
  .object({
    attemptId: Id,
    student: z.object({ id: Id, displayName: DisplayName }).strict(),
    status: AttemptStatus,
    submittedAt: Timestamp.nullable(),
    late: z.boolean(),
    publication: Publication,
    answers: Answers,
    choices: Choices,
    answerKey: AnswerKeyRevision.nullable(),
    grade: Grade.nullable(),
  })
  .strict();
export type AttemptForGrading = z.infer<typeof AttemptForGrading>;

const noArgs = z.object({}).strict();
const attemptOnly = z.object({ p_attempt_id: Id }).strict();

export const DELIVERY_RPCS = {
  publish_version: {
    args: z
      .object({ p_version_id: Id, p_revision: Revision, p_op_key: Id, p_answer_key_revision_id: Id.optional() })
      .strict(),
    result: z.object({ publicationId: Id, attempts: z.int().min(0) }).strict(),
  },
  open_attempt: {
    args: z.object({ p_assignment_id: Id }).strict(),
    result: z.object({ attemptId: Id, status: AttemptStatus }).strict(),
  },
  start_attempt: {
    args: attemptOnly,
    result: z.object({ attemptId: Id, status: AttemptStatus, draftRevision: Revision }).strict(),
  },
  save_draft: {
    args: z.object({ p_attempt_id: Id, p_revision: Revision, p_answers: Answers, p_choices: Choices }).strict(),
    result: z.object({ revision: Revision }).strict(),
  },
  submit_attempt: {
    args: z.object({ p_attempt_id: Id, p_revision: Revision }).strict(),
    // alreadySubmitted: a second click found it submitted and changed nothing.
    result: z.object({ submittedAt: Timestamp, late: z.boolean(), alreadySubmitted: z.boolean() }).strict(),
  },
  list_assessment_attempts: {
    args: z.object({ p_assessment_id: Id }).strict(),
    result: z.object({ items: z.array(AttemptRow) }).strict(),
  },
  get_attempt_for_grading: { args: attemptOnly, result: AttemptForGrading },
  grade_attempt: {
    args: z
      .object({
        p_attempt_id: Id,
        p_feedback: z.string().max(5000),
        p_exercise_results: z.record(Id, ExerciseResult),
        p_score: Score.optional(),
        p_revision: Revision.optional(),
      })
      .strict(),
    result: z.object({ attemptId: Id, revision: Revision }).strict(),
  },
  student_home: { args: noArgs, result: StudentHome },
  student_task_list: { args: noArgs, result: StudentTaskList },
  student_task: { args: attemptOnly, result: StudentTask },
  student_grades: { args: noArgs, result: StudentGrades },
} satisfies Record<string, RpcSpec>;
