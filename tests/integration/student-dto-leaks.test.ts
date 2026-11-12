import { beforeAll, describe, expect, it } from "vitest";
import { checkStudentDto, findLeaks, type LeakOptions } from "@/lib/domain/delivery/leaks";
import { PROFILE_WORDS, STUDENT_DTO_ALLOWLISTS, type StudentDtoName } from "@/lib/domain/delivery/student-dto";
import { readRows, runRpc } from "./support/db";
import { describeOutcome } from "./support/session";
import { teacherOf } from "./support/world";
import { buildClass, learner, must, publishVersion, withAccount, type Class, type Learner } from "./student-dto-support";

// The leak test of the student's four reads (T1.5d, docs/contratos/fase-1.md «Prueba de fugas»). A group with two students of
// different profiles (motor, who looks; dyslexia, who types), each with their own version, through the real RPCs as each
// student's own session. The JSON of every DTO goes through checkStudentDto with the ids that must never appear (the other
// student, the pseudonyms, the versions, the key), the profile words and the correct options. Placeholder text only.

type Dtos = Record<StudentDtoName, Record<string, unknown>>;
const NAMES: StudentDtoName[] = ["student_home", "student_task_list", "student_task", "student_grades"];

async function call(reader: Learner, rpc: string, attempt?: string): Promise<Record<string, unknown>> {
  const outcome = await runRpc(reader.actor, rpc, attempt === undefined ? {} : { p_attempt_id: attempt });
  if (!outcome.ok) throw new Error(`${rpc} falló: ${describeOutcome(outcome)}.`);
  return outcome.value;
}

async function readAll(reader: Learner): Promise<Dtos> {
  return {
    student_home: await call(reader, "student_home"),
    student_task_list: await call(reader, "student_task_list"),
    student_task: await call(reader, "student_task", reader.attemptId),
    student_grades: await call(reader, "student_grades"),
  };
}

/** What may not appear for this reader: the other student's ids, the pseudonyms, every version and every key. */
async function optionsFor(c: Class, reader: Learner): Promise<LeakOptions> {
  const other = reader === c.gaze ? c.typed : c.gaze;
  const pseudonyms = await readRows<{ id: string }>("select id::text as id from app.student_pseudonyms where student_id in ($1, $2)", [c.gaze.studentId, c.typed.studentId]);
  const revisions = await readRows<{ id: string }>("select id::text as id from app.answer_key_revisions where version_id = $1", [c.versions[0] ?? ""]);
  return {
    forbiddenIds: new Set([
      c.gaze.studentId, c.typed.studentId, c.gaze.userId, c.typed.userId, other.attemptId, other.assignmentId,
      ...pseudonyms.map((row) => row.id), ...c.versions, ...c.keyIds, ...revisions.map((row) => row.id),
    ]),
    forbiddenWords: PROFILE_WORDS,
    correctOptionIds: new Set(["B"]),
  };
}

async function expectClean(c: Class, reader: Learner): Promise<Dtos> {
  const dtos = await readAll(reader);
  const options = await optionsFor(c, reader);
  for (const name of NAMES) expect(checkStudentDto(name, dtos[name], options), name).toEqual([]);
  return dtos;
}

/** The student solves what they were given and the teacher corrects it: every DTO now has content. */
async function solveAndGrade(c: Class, reader: Learner): Promise<void> {
  const task = await call(reader, "student_task", reader.attemptId);
  const exercises = Array.isArray(task.exercises) ? task.exercises : [];
  const ids = exercises.map((item) => (typeof item === "object" && item !== null ? String(Reflect.get(item, "id")) : ""));
  const questions = Array.isArray(task.questions) ? task.questions : [];
  const choices = Object.fromEntries(questions.map((item) => [String(Reflect.get(item, "id")), "B"]));
  await must(reader.actor, "student_start_attempt", { p_attempt_id: reader.attemptId });
  const answers = Object.fromEntries(ids.map((id) => [id, { text: "mi respuesta", mode: "typed" }]));
  await must(reader.actor, "student_save_draft", { p_attempt_id: reader.attemptId, p_revision: 1, p_answers: JSON.stringify(answers), p_choices: JSON.stringify(choices) });
  await must(reader.actor, "student_submit_attempt", { p_attempt_id: reader.attemptId, p_revision: 2 });
  const results = Object.fromEntries(ids.map((id) => [id, { status: "correct", errors: [] }]));
  await must(teacherOf(c.o.world), "grade_attempt", { p_attempt_id: reader.attemptId, p_feedback: "Muy bien", p_exercise_results: JSON.stringify(results), p_score: 9, p_revision: null });
}

describe("what the student reads never leaks", () => {
  let c: Class;
  beforeAll(async () => {
    c = await buildClass();
  });

  it("before starting: the four reads of each student are clean", async () => {
    await expectClean(c, c.gaze);
    await expectClean(c, c.typed);
  });

  it("after solving and being corrected: still clean, and with content to check", async () => {
    await solveAndGrade(c, c.gaze);
    await solveAndGrade(c, c.typed);
    const looking = await expectClean(c, c.gaze);
    const typing = await expectClean(c, c.typed);
    expect(looking.student_grades.grades).toHaveLength(1);
    expect(typing.student_grades.grades).toHaveLength(1);
    expect(looking.student_task.draft).toMatchObject({ revision: 2 });
  });

  it("the profile does not show in the shape: the same keys and the same aids for the one who looks and the one who types", async () => {
    const looking = await readAll(c.gaze);
    const typing = await readAll(c.typed);
    for (const name of NAMES) expect(Object.keys(looking[name]).sort(), name).toEqual(Object.keys(typing[name]).sort());
    expect(looking.student_task.aids).toEqual(typing.student_task.aids);
    expect(looking.student_home.interface).toBe("gaze");
    expect(typing.student_home.interface).toBe("standard");
    expect(looking.student_task.answerMode).toBe("gaze");
    expect(typing.student_task.answerMode).toBe("typed");
  });

  it("the allowlists name every key of what the RPCs return", async () => {
    const task = await call(c.gaze, "student_task", c.gaze.attemptId);
    expect(findLeaks(task, STUDENT_DTO_ALLOWLISTS.student_task)).toEqual([]);
  });
});

describe("the planted leaks fail", () => {
  let c: Class;
  beforeAll(async () => {
    c = await buildClass();
  });

  it("a version whose text names the profile (the real read of a published version)", async () => {
    const third = await withAccount(c.o);
    await publishVersion(c.o, { students: [third.studentId], answerMode: "typed", body: "Ejercicio adaptado para dislexia", profile: "dyslexia" });
    const reader = await learner(c.o, third);
    const task = await call(reader, "student_task", reader.attemptId);
    const leaks = checkStudentDto("student_task", task, await optionsFor(c, c.typed));
    expect(leaks).toContain("exercises.0.body");
  });

  it("a title that includes the id of the other student (the real read, with the topic changed by the owner)", async () => {
    const clean = checkStudentDto("student_task_list", await call(c.gaze, "student_task_list"), await optionsFor(c, c.gaze));
    expect(clean).toEqual([]);
    await readRows("update app.assessments set topic = $1 where id = $2", [`Repaso ${c.typed.studentId}`, c.o.assessmentId]);
    try {
      const list = checkStudentDto("student_task_list", await call(c.gaze, "student_task_list"), await optionsFor(c, c.gaze));
      const task = checkStudentDto("student_task", await call(c.gaze, "student_task", c.gaze.attemptId), await optionsFor(c, c.gaze));
      expect(list).toContain("tasks.0.title");
      expect(task).toContain("title");
    } finally {
      await readRows("update app.assessments set topic = $1 where id = $2", ["Repaso", c.o.assessmentId]);
    }
  });

  it("a correct option in an id field that is not the list of options", async () => {
    const task = await call(c.gaze, "student_task", c.gaze.attemptId);
    const options = await optionsFor(c, c.gaze);
    expect(checkStudentDto("student_task", task, options)).toEqual([]);
    const questions = Array.isArray(task.questions) ? task.questions : [];
    const planted = { ...task, questions: questions.map((question) => ({ ...question, exerciseId: "B" })) };
    expect(findLeaks(planted, STUDENT_DTO_ALLOWLISTS.student_task, options)).toContain("questions.0.exerciseId");
    expect(checkStudentDto("student_task", planted, options).length).toBeGreaterThan(0);
  });
});
