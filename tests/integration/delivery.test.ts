import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openAttempt, saveDraft, startAttempt, submitAttempt } from "@/lib/server/repos/attempts";
import { getAttemptForGrading, gradeAttempt, listAssessmentAttempts } from "@/lib/server/repos/grading";
import { publishVersion } from "@/lib/server/repos/publications";
import { withRequestId } from "@/lib/server/repos/rpc";
import { studentTask } from "@/lib/server/repos/student";
import { createSchool } from "../factories";
import { auditRows } from "../factories/students";
import { classroom, publishTyped } from "./delivery-support";

const NOT_FOUND = { code: "NOT_FOUND" };

describe("repos of publication", () => {
  it("publishes the approved version, and repeating the same opKey answers the same", async () => {
    const room = await classroom();
    const published = await publishTyped(room);
    expect(published.publish.attempts).toBe(1);
    const again = await publishVersion(room.teacher.client, published.versionId, published.publish.input);
    expect(again).toEqual({ publicationId: published.publicationId, attempts: 1 });
    const other = { ...published.publish.input, revision: published.publish.input.revision + 1 };
    await expect(publishVersion(room.teacher.client, published.versionId, other)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a stale revision is CONFLICT, and a teacher of another institution gets NOT_FOUND", async () => {
    const room = await classroom();
    const published = await publishTyped(room);
    const stale = { revision: 1, opKey: randomUUID() };
    await expect(publishVersion(room.teacher.client, published.versionId, stale)).rejects.toMatchObject({ code: "CONFLICT" });
    const stranger = (await createSchool()).teacher.client;
    await expect(publishVersion(stranger, published.versionId, stale)).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("repos of the attempt and the correction", () => {
  it("the student opens, starts, saves and submits; the teacher lists, reads (audited) and grades", async () => {
    const room = await classroom();
    const p = await publishTyped(room);
    const student = p.student.client;
    expect(await openAttempt(student, p.assignmentId)).toEqual({ attemptId: p.attemptId, status: "opened" });
    const started = await startAttempt(student, p.attemptId);
    expect(started).toMatchObject({ attemptId: p.attemptId, status: "started" });
    const [exerciseId] = p.exerciseIds;
    if (exerciseId === undefined) throw new Error("Falta el ejercicio.");
    const answers = { [exerciseId]: { text: "mi respuesta", mode: "typed" as const } };
    const saved = await saveDraft(student, p.attemptId, { revision: started.draftRevision, answers, choices: {} });
    expect(saved.revision).toBe(started.draftRevision + 1);
    const stale = { revision: started.draftRevision, answers, choices: {} };
    await expect(saveDraft(student, p.attemptId, stale)).rejects.toMatchObject({ code: "CONFLICT" });
    const submitted = await submitAttempt(student, p.attemptId, saved.revision);
    expect(submitted.alreadySubmitted).toBe(false);
    const repeated = await submitAttempt(student, p.attemptId, saved.revision);
    expect(repeated).toMatchObject({ alreadySubmitted: true, submittedAt: submitted.submittedAt });

    const teacher = room.teacher.client;
    expect(await listAssessmentAttempts(teacher, p.assessmentId)).toEqual([
      expect.objectContaining({ studentId: p.student.id, attemptId: p.attemptId, status: "submitted", graded: false, score: null }),
    ]);
    const requestId = randomUUID();
    const read = await getAttemptForGrading(withRequestId(teacher, requestId), p.attemptId);
    expect(read).toMatchObject({ attemptId: p.attemptId, status: "submitted", answers });
    expect(await auditRows(requestId)).toEqual([
      expect.objectContaining({ action: "get_attempt_for_grading", entity: "attempt", entity_id: p.attemptId, student_ids: [p.student.id] }),
    ]);

    const results = { [exerciseId]: { status: "correct" as const, errors: [] } };
    const graded = await gradeAttempt(teacher, p.attemptId, { feedback: "Muy bien", exerciseResults: results, score: 9 });
    expect(graded.attemptId).toBe(p.attemptId);
    const after = await getAttemptForGrading(teacher, p.attemptId);
    expect(after.grade).toMatchObject({ score: 9, feedback: "Muy bien", revision: graded.revision });
    const old = { feedback: "Otra", exerciseResults: results, score: 8, revision: graded.revision + 1 };
    await expect(gradeAttempt(teacher, p.attemptId, old)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a teacher of another institution gets NOT_FOUND, leaves no audit row and changes nothing", async () => {
    const room = await classroom();
    const p = await publishTyped(room);
    await startAttempt(p.student.client, p.attemptId);
    await submitAttempt(p.student.client, p.attemptId, 1);
    const requestId = randomUUID();
    const stranger = withRequestId((await createSchool()).teacher.client, requestId);
    await expect(getAttemptForGrading(stranger, p.attemptId)).rejects.toMatchObject(NOT_FOUND);
    await expect(listAssessmentAttempts(stranger, p.assessmentId)).rejects.toMatchObject(NOT_FOUND);
    const grade = { feedback: "Hola", exerciseResults: {}, score: 5 };
    await expect(gradeAttempt(stranger, p.attemptId, grade)).rejects.toMatchObject(NOT_FOUND);
    expect(await auditRows(requestId)).toEqual([]);
    expect((await getAttemptForGrading(room.teacher.client, p.attemptId)).grade).toBeNull();
  });

  it("a student can neither read nor touch the attempt of another", async () => {
    const room = await classroom();
    const mine = await publishTyped(room);
    const theirs = await publishTyped(room);
    const me = mine.student.client;
    await expect(openAttempt(me, theirs.assignmentId)).rejects.toMatchObject(NOT_FOUND);
    await expect(startAttempt(me, theirs.attemptId)).rejects.toMatchObject(NOT_FOUND);
    await expect(saveDraft(me, theirs.attemptId, { revision: 1, answers: {}, choices: {} })).rejects.toMatchObject(NOT_FOUND);
    await expect(submitAttempt(me, theirs.attemptId, 1)).rejects.toMatchObject(NOT_FOUND);
    await expect(studentTask(me, theirs.attemptId)).rejects.toMatchObject(NOT_FOUND);
    await expect(getAttemptForGrading(me, mine.attemptId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await openAttempt(theirs.student.client, theirs.assignmentId)).toMatchObject({ status: "opened" });
  });
});
