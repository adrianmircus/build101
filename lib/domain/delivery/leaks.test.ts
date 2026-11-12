import { describe, expect, it } from "vitest";
import { checkStudentDto, findLeaks } from "./leaks";
import {
  NEVER_FOR_STUDENTS,
  PROFILE_WORDS,
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

  const forbiddenIds = new Set([OTHER]);

  it("reports a forbidden id as a value, such as another student's id", () => {
    const leaked = { ...examples.student_home, groups: [{ id: OTHER, name: "3.º A", subjectId: "math" }] };
    expect(findLeaks(leaked, STUDENT_DTO_ALLOWLISTS.student_home, { forbiddenIds })).toEqual(["groups.0.id"]);
  });

  it("reports a forbidden id embedded in text, whatever its case", () => {
    const leaked = { ...examples.student_home, groups: [{ id: ID, name: `Referencia: ${OTHER.toUpperCase()}`, subjectId: "math" }] };
    expect(findLeaks(leaked, STUDENT_DTO_ALLOWLISTS.student_home, { forbiddenIds })).toEqual(["groups.0.name"]);
  });

  it("reports a forbidden id used as a key, even inside the student's own answers", () => {
    const leaked = { ...examples.student_task, draft: { revision: 1, answers: { [OTHER]: { text: "x", mode: "typed" } }, choices: {} } };
    expect(findLeaks(leaked, task, { forbiddenIds })).toEqual([`draft.answers.${OTHER}`]);
  });

  // The correct option of the example's question is "A": a visible option and the student's choice.
  const correct = [{ value: "A", allowedAt: ["questions.*.options.*.id", "draft.choices.*"] }];

  it("lets a secret appear where it is legitimately visible: the options and the student's own choice", () => {
    expect(findLeaks(examples.student_task, task, { secrets: correct })).toEqual([]);
  });

  it("reports a secret anywhere else", () => {
    const leaked = { ...examples.student_task, exercises: [{ id: ID, label: "A", body: "x + 1 = 2" }] };
    expect(findLeaks(leaked, task, { secrets: correct })).toEqual(["exercises.0.label"]);
  });

  it("reports a profile word inside text the server wrote, whatever its case and accents", () => {
    const leaked = { ...examples.student_task, exercises: [{ id: ID, label: "1", body: "Ejercicio adaptado para DISLEXÍA" }] };
    expect(findLeaks(leaked, task, { forbiddenWords: PROFILE_WORDS })).toEqual(["exercises.0.body"]);
  });

  it("does not flag the student's own answers for what they wrote", () => {
    const own = { ...examples.student_task, draft: { revision: 1, answers: { [ID]: { text: "Tengo dislexia", mode: "typed" } }, choices: {} } };
    expect(findLeaks(own, task, { forbiddenWords: PROFILE_WORDS })).toEqual([]);
  });

  it("finds no profile word in the fullest DTOs", () => {
    const names = ["student_home", "student_task_list", "student_task", "student_grades"] as const;
    for (const name of names) {
      expect(checkStudentDto(name, examples[name], { forbiddenWords: PROFILE_WORDS }), name).toEqual([]);
    }
  });
});

describe("checkStudentDto", () => {
  it("reports a structure that does not match the schema, such as a missing field", () => {
    const withoutAids = { ...examples.student_task, aids: undefined };
    expect(checkStudentDto("student_task", withoutAids)).toEqual(["schema: aids"]);
  });

  it("reports an extra key both as a schema error and as a leak", () => {
    const leaked = { ...examples.student_home, profiles: ["motor"] };
    expect(checkStudentDto("student_home", leaked)).toEqual(["schema: (root)", "profiles"]);
  });
});
