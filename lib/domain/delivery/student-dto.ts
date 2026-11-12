import { z } from "zod";
import { AssessmentKind } from "../assessments/entities";
import { AnswerMode, GraphSpec, OptionId } from "../assessments/versions";
import { DisplayName, Id, SubjectId, Timestamp } from "../common";
import { PROFILE_IDS } from "../students/needs";
import { Aids, Answers, Choices, ExerciseResultStatus, Score } from "./entities";

// What a student reads, one DTO per context (docs/PLATAFORMA.md, «Lo que ve el estudiante»).
// Every object is strict and every key is in the allowlist below: no profile, need, support,
// interest, correct option, change or its reason, version id, pseudonym or other student. The
// student's own answers may travel. The leak test (T1.5d) walks the JSON the RPCs return, and
// later the RSC payload (T4.8), with these lists.

/** How the student answers. Computed by the server; without dictation consent voice is typed. */
export const StudentInterface = z.enum(["standard", "gaze", "voice"]);

export const StudentHome = z
  .object({
    displayName: DisplayName,
    interface: StudentInterface,
    groups: z.array(z.object({ id: Id, name: z.string(), subjectId: SubjectId }).strict()),
  })
  .strict();
export type StudentHome = z.infer<typeof StudentHome>;

export const StudentTaskStatus = z.enum(["not_started", "in_progress", "submitted", "graded"]);

export const StudentTaskSummary = z
  .object({
    assignmentId: Id,
    attemptId: Id,
    title: z.string(),
    kind: AssessmentKind,
    subjectId: SubjectId,
    publishAt: Timestamp.nullable(),
    dueAt: Timestamp.nullable(),
    status: StudentTaskStatus,
    late: z.boolean(),
  })
  .strict();

export const StudentTaskList = z.object({ tasks: z.array(StudentTaskSummary) }).strict();
export type StudentTaskList = z.infer<typeof StudentTaskList>;

const StudentOption = z.object({ id: OptionId, text: z.string(), graph: GraphSpec.optional() }).strict();

export const StudentTask = z
  .object({
    attemptId: Id,
    assignmentId: Id,
    title: z.string(),
    kind: AssessmentKind,
    subjectId: SubjectId,
    generalInstructions: z.string(),
    answerMode: AnswerMode,
    aids: Aids,
    dueAt: Timestamp.nullable(),
    readOnly: z.boolean(),
    late: z.boolean(),
    submittedAt: Timestamp.nullable(),
    exercises: z.array(z.object({ id: Id, label: z.string(), body: z.string() }).strict()),
    questions: z.array(z.object({ id: Id, exerciseId: Id, stem: z.string(), options: z.array(StudentOption) }).strict()),
    draft: z.object({ revision: z.int().min(1), answers: Answers, choices: Choices }).strict(),
  })
  .strict();
export type StudentTask = z.infer<typeof StudentTask>;

export const StudentGrade = z
  .object({
    assignmentId: Id,
    attemptId: Id,
    title: z.string(),
    kind: AssessmentKind,
    subjectId: SubjectId,
    score: Score.nullable(),
    feedback: z.string(),
    gradedAt: Timestamp.nullable(),
    exercises: z.array(z.object({ exerciseId: Id, label: z.string(), status: ExerciseResultStatus }).strict()),
  })
  .strict();

export const StudentGrades = z.object({ grades: z.array(StudentGrade) }).strict();
export type StudentGrades = z.infer<typeof StudentGrades>;

/**
 * keys: every object key allowed at any depth. idKeyed: objects whose keys are ids, not names.
 * ownContent: subtrees the student wrote (their answers): exempt from the forbidden-words check.
 * revealable: keys whose value is free text the server wrote and where a solution could be given
 * away («Respuesta correcta: A»). Secrets are looked for only there; never in labels, option texts
 * or the student's own answers, where the same value («1», «A») appears legitimately.
 */
export type DtoAllowlist = {
  keys: ReadonlySet<string>;
  idKeyed: ReadonlySet<string>;
  ownContent: ReadonlySet<string>;
  revealable: ReadonlySet<string>;
};

const GRAPH_KEYS = ["graph", "functions", "expr", "label", "points", "x", "y", "window", "xMin", "xMax", "yMin", "yMax"];
const ANSWER_KEYS = ["text", "mode", "transcript", "graph"];

type AllowlistInput = { keys: string[]; idKeyed?: string[]; revealable?: string[] };

function allowlist({ keys, idKeyed = [], revealable = [] }: AllowlistInput): DtoAllowlist {
  // Whatever is keyed by id here is the student's own draft: answers and choices.
  return { keys: new Set(keys), idKeyed: new Set(idKeyed), ownContent: new Set(idKeyed), revealable: new Set(revealable) };
}

export const STUDENT_DTO_ALLOWLISTS = {
  student_home: allowlist({ keys: ["displayName", "interface", "groups", "id", "name", "subjectId"] }),
  student_task_list: allowlist({
    keys: ["tasks", "assignmentId", "attemptId", "title", "kind", "subjectId", "publishAt", "dueAt", "status", "late"],
    revealable: ["title"],
  }),
  student_task: allowlist({
    keys: [
      "attemptId", "assignmentId", "title", "kind", "subjectId", "generalInstructions", "answerMode", "aids",
      "readAloud", "dueAt", "readOnly", "late", "submittedAt", "exercises", "id", "label", "body", "questions",
      "exerciseId", "stem", "options", "draft", "revision", "answers", "choices", ...ANSWER_KEYS, ...GRAPH_KEYS,
    ],
    idKeyed: ["answers", "choices"],
    revealable: ["title", "generalInstructions", "body", "stem"],
  }),
  // After grading, the teacher's feedback may discuss the right answer: it is not revealable.
  student_grades: allowlist({
    keys: [
      "grades", "assignmentId", "attemptId", "title", "kind", "subjectId", "score", "feedback", "gradedAt",
      "exercises", "exerciseId", "label", "status",
    ],
    revealable: ["title"],
  }),
} as const satisfies Record<string, DtoAllowlist>;

export const STUDENT_DTO_SCHEMAS = {
  student_home: StudentHome,
  student_task_list: StudentTaskList,
  student_task: StudentTask,
  student_grades: StudentGrades,
} as const;
export type StudentDtoName = keyof typeof STUDENT_DTO_SCHEMAS;

/**
 * Words that name a profile, in the catalogue's ids and in Spanish. None may appear in text the
 * server sends a student (an adapted exercise that says «adaptado para dislexia» is a leak). The
 * leak test's fixtures avoid them; a false positive is fixed in the fixture, never by dropping a word.
 */
export const PROFILE_WORDS = [
  ...PROFILE_IDS,
  "tdah", "deficit de atencion", "tea", "autismo", "autista", "asperger", "dislexia", "dislexico", "disgrafia",
  "motriz", "discapacidad", "perfil", "adaptado para", "adaptacion",
] as const;

/** Keys that must never reach a student, whatever the DTO: the leak test names them on failure. */
export const NEVER_FOR_STUDENTS = [
  "profiles", "profile", "needs", "supports", "interests", "config", "changes", "why", "answer", "correctOptionId",
  "key", "answerKey", "rubric", "versionId", "recipients", "studentIds", "pseudonym", "pseudonymId", "errors",
] as const;
