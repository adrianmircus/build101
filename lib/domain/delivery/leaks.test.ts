import { describe, expect, it } from "vitest";
import { findLeaks } from "./leaks";
import {
  NEVER_FOR_STUDENTS,
  STUDENT_DTO_ALLOWLISTS,
  StudentGrades,
  StudentHome,
  StudentTask,
  StudentTaskList,
} from "./student-dto";

const ID = "6f1c2a8e-3b4d-4c5e-9f60-718293a4b5c6";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const graph = { functions: [{ expr: "x^2", label: "f" }], points: [{ x: 0, y: 0, label: "O" }], window: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 } };

// The fullest DTO each schema allows: if a schema gains a key the allowlist lacks, these fail.
const examples = {
  student_home: StudentHome.parse({ displayName: "Paula", interface: "gaze", groups: [{ id: ID, name: "3.º A", subjectId: "math" }] }),
  student_task_list: StudentTaskList.parse({
    tasks: [{ assignmentId: ID, attemptId: ID, title: "Ecuaciones", kind: "worksheet", subjectId: "math", publishAt: null, dueAt: null, status: "in_progress", late: false }],
  }),
  student_task: StudentTask.parse({
    attemptId: ID, assignmentId: ID, title: "Ecuaciones", kind: "exam", subjectId: "math", generalInstructions: "Elegí dos.",
    answerMode: "gaze", aids: { readAloud: true }, dueAt: null, readOnly: false, late: false, submittedAt: null,
    exercises: [{ id: ID, label: "1", body: "x + 1 = 2" }],
    questions: [{ id: ID, exerciseId: ID, stem: "¿Cuánto vale x?", options: [{ id: "A", text: "1", graph }, { id: "B", text: "2" }] }],
    draft: { revision: 3, answers: { [ID]: { text: "x = 1", mode: "voice", transcript: "equis igual a uno", graph } }, choices: { [ID]: "A" } },
  }),
  student_grades: StudentGrades.parse({
    grades: [{ assignmentId: ID, attemptId: ID, title: "Ecuaciones", kind: "worksheet", subjectId: "math", score: 8, feedback: "¡Bien!", gradedAt: null, exercises: [{ exerciseId: ID, label: "1", status: "correct" }] }],
  }),
};

describe("student DTO allowlists", () => {
  it("cover every key of the fullest DTO each schema allows", () => {
    const names = ["student_home", "student_task_list", "student_task", "student_grades"] as const;
    for (const name of names) expect(findLeaks(examples[name], STUDENT_DTO_ALLOWLISTS[name]), name).toEqual([]);
  });

  it("never allow a key that must not reach a student", () => {
    for (const allowlist of Object.values(STUDENT_DTO_ALLOWLISTS)) {
      for (const key of NEVER_FOR_STUDENTS) expect(allowlist.keys.has(key), key).toBe(false);
    }
  });

  it("schemas refuse extra keys before anything is sent", () => {
    expect(StudentHome.safeParse({ ...examples.student_home, profiles: ["motor"] }).success).toBe(false);
  });
});

describe("findLeaks", () => {
  const task = STUDENT_DTO_ALLOWLISTS.student_task;

  it("reports a key outside the allowlist, with its path", () => {
    const leaked = { ...examples.student_task, exercises: [{ id: ID, label: "1", body: "x", changes: [{ why: "TDAH" }] }] };
    expect(findLeaks(leaked, task)).toEqual(["exercises.0.changes", "exercises.0.changes.0.why"]);
  });

  it("reports a name used as a key inside an id-keyed object", () => {
    const leaked = { draft: { revision: 1, answers: { correct: { text: "x" } }, choices: {} } };
    expect(findLeaks(leaked, task)).toEqual(["draft.answers.correct"]);
  });

  it("reports a forbidden value anywhere, such as another student's id", () => {
    const leaked = { ...examples.student_home, groups: [{ id: OTHER, name: "3.º A", subjectId: "math" }] };
    expect(findLeaks(leaked, STUDENT_DTO_ALLOWLISTS.student_home, { forbiddenValues: new Set([OTHER]) })).toEqual(["groups.0.id"]);
  });
});
