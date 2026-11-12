import { describe, expect, it } from "vitest";
import { checkStudentDto, type LeakOptions } from "@/lib/domain/delivery/leaks";
import { PROFILE_WORDS } from "@/lib/domain/delivery/student-dto";
import { saveDraft, startAttempt, submitAttempt } from "@/lib/server/repos/attempts";
import { gradeAttempt } from "@/lib/server/repos/grading";
import { studentGrades, studentHome, studentTask, studentTaskList } from "@/lib/server/repos/student";
import { readRows } from "./support/db";
import { classroom, publishGaze, publishTyped, type Classroom, type Published } from "./delivery-support";

// The four reads of the student, as each student's own session, with the leak check of T1.5d.

async function forbidden(room: Classroom, own: Published, other: Published): Promise<LeakOptions> {
  const pseudonyms = await readRows<{ id: string }>(
    "select id::text as id from app.student_pseudonyms where student_id in ($1, $2)",
    [own.student.id, other.student.id],
  );
  return {
    forbiddenIds: new Set([
      room.teacher.id, own.student.id, other.student.id, own.student.userId, other.student.userId, other.attemptId,
      other.assignmentId, other.versionId, other.publicationId, own.versionId, own.publicationId,
      ...pseudonyms.map((row) => row.id),
    ]),
    forbiddenWords: PROFILE_WORDS,
    correctOptionIds: new Set(["A"]),
  };
}

/** The student solves what they got and the teacher corrects it, so that the grades have content. */
async function solveAndGrade(room: Classroom, p: Published, choices: Record<string, "A" | "B">) {
  const me = p.student.client;
  const started = await startAttempt(me, p.attemptId);
  const answers = Object.fromEntries(p.exerciseIds.map((id) => [id, { text: "mi respuesta", mode: "typed" as const }]));
  const saved = await saveDraft(me, p.attemptId, { revision: started.draftRevision, answers, choices });
  await submitAttempt(me, p.attemptId, saved.revision);
  const results = Object.fromEntries(p.exerciseIds.map((id) => [id, { status: "correct" as const, errors: [] }]));
  await gradeAttempt(room.teacher.client, p.attemptId, { feedback: "Muy bien", exerciseResults: results, score: 9 });
}

describe("repos of what the student reads", () => {
  it("the four reads answer the student's own, and pass the leak check", async () => {
    const room = await classroom();
    const gaze = await publishGaze(room);
    const typed = await publishTyped(room);
    const options = await forbidden(room, gaze, typed);
    const me = gaze.student.client;

    const home = await studentHome(me);
    expect(home).toMatchObject({ displayName: gaze.student.displayName, groups: [expect.objectContaining({ id: room.groupId })] });
    const list = await studentTaskList(me);
    expect(list.tasks).toEqual([expect.objectContaining({ attemptId: gaze.attemptId, status: "not_started", title: "Repaso" })]);
    const task = await studentTask(me, gaze.attemptId);
    expect(task).toMatchObject({ attemptId: gaze.attemptId, answerMode: "gaze", readOnly: false });
    expect(task.questions).toHaveLength(2);
    expect(await studentGrades(me)).toEqual({ grades: [] });

    expect(checkStudentDto("student_home", home, options)).toEqual([]);
    expect(checkStudentDto("student_task_list", list, options)).toEqual([]);
    expect(checkStudentDto("student_task", task, options)).toEqual([]);
  });

  it("after being corrected, the grades show up and every read is still clean", async () => {
    const room = await classroom();
    const gaze = await publishGaze(room);
    const typed = await publishTyped(room);
    const choices = Object.fromEntries(gaze.questionIds.map((id) => [id, "B" as const]));
    await solveAndGrade(room, gaze, choices);
    await solveAndGrade(room, typed, {});
    const options = await forbidden(room, gaze, typed);
    const me = gaze.student.client;

    const grades = await studentGrades(me);
    expect(grades.grades).toEqual([expect.objectContaining({ attemptId: gaze.attemptId, score: 9, feedback: "Muy bien" })]);
    const task = await studentTask(me, gaze.attemptId);
    expect(task).toMatchObject({ readOnly: true, draft: { choices } });
    expect(checkStudentDto("student_grades", grades, options)).toEqual([]);
    expect(checkStudentDto("student_task", task, options)).toEqual([]);
    expect((await studentTaskList(me)).tasks[0]).toMatchObject({ status: "graded" });
  });

  it("each student reads only their own, and the profile does not show in the shape", async () => {
    const room = await classroom();
    const gaze = await publishGaze(room);
    const typed = await publishTyped(room);
    expect((await studentTaskList(typed.student.client)).tasks).toHaveLength(1);
    expect((await studentTaskList(typed.student.client)).tasks[0]?.attemptId).toBe(typed.attemptId);
    await expect(studentTask(typed.student.client, gaze.attemptId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const keys = async (p: Published) => Object.keys(await studentTask(p.student.client, p.attemptId)).sort();
    expect(await keys(gaze)).toEqual(await keys(typed));
    expect((await studentHome(typed.student.client)).displayName).toBe(typed.student.displayName);
  });

  it("a teacher is not a student: the four reads are denied", async () => {
    const room = await classroom();
    const typed = await publishTyped(room);
    const teacher = room.teacher.client;
    await expect(studentHome(teacher)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(studentTaskList(teacher)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(studentGrades(teacher)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(studentTask(teacher, typed.attemptId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
