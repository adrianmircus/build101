import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  approveVersion,
  rejectVersion,
  setQuestionKey,
  updateVersionExercise,
  updateVersionInstructions,
  updateVersionQuestion,
} from "@/lib/server/repos/version-content";
import { getVersion } from "@/lib/server/repos/versions";
import { createGroup, createSchool } from "../factories";
import { createGazeContent, OPTIONS } from "../factories/generations";

async function setup() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  const content = await createGazeContent(school, group.id);
  const [exerciseId, questionId] = [content.adapted[0], content.questions[0]];
  if (exerciseId === undefined || questionId === undefined) throw new Error("Falta contenido de prueba.");
  return { ...school, content, exerciseId, questionId };
}

describe("repos of version content", () => {
  it("edits the instructions, and repeating the same opId answers the same", async () => {
    const { teacher, content } = await setup();
    const before = (await getVersion(teacher.client, content.versionId)).version;
    const changes = { revision: before.instructionsRevision, generalInstructions: "Más corto.", opId: randomUUID() };
    const written = await updateVersionInstructions(teacher.client, content.versionId, changes);
    expect(written.instructionsRevision).toBe(before.instructionsRevision + 1);
    expect(written.versionRevision).toBeGreaterThan(before.revision);
    expect(await updateVersionInstructions(teacher.client, content.versionId, changes)).toEqual(written);
    const stale = { ...changes, opId: randomUUID() };
    await expect(updateVersionInstructions(teacher.client, content.versionId, stale)).rejects.toMatchObject({ code: "CONFLICT" });
    const after = (await getVersion(teacher.client, content.versionId)).version;
    expect(after.generalInstructions).toBe("Más corto.");
  });

  it("edits an adapted exercise, and repeating the same opId answers the same", async () => {
    const { teacher, content, exerciseId } = await setup();
    const detail = await getVersion(teacher.client, content.versionId);
    const current = detail.exercises.find((exercise) => exercise.id === exerciseId);
    const changes = { revision: current?.revision ?? 0, body: "Texto del profe", opId: randomUUID() };
    const written = await updateVersionExercise(teacher.client, exerciseId, changes);
    expect(written).toMatchObject({ id: exerciseId, revision: changes.revision + 1 });
    expect(await updateVersionExercise(teacher.client, exerciseId, changes)).toEqual(written);
    const stale = { ...changes, opId: randomUUID() };
    await expect(updateVersionExercise(teacher.client, exerciseId, stale)).rejects.toMatchObject({ code: "CONFLICT" });
    const after = await getVersion(teacher.client, content.versionId);
    expect(after.exercises.find((exercise) => exercise.id === exerciseId)?.body).toBe("Texto del profe");
    expect(after.version.revision).toBe(written.versionRevision);
  });

  it("edits a question and its correct option", async () => {
    const { teacher, content, questionId } = await setup();
    const question = (await getVersion(teacher.client, content.versionId)).questions.find((item) => item.id === questionId);
    const options = [...OPTIONS, { id: "C", text: "Tres" }];
    const changes = { revision: question?.revision ?? 0, stem: "Otra pregunta", options, opId: randomUUID() };
    const written = await updateVersionQuestion(teacher.client, questionId, changes);
    expect(await updateVersionQuestion(teacher.client, questionId, changes)).toEqual(written);

    const first = await setQuestionKey(teacher.client, questionId, { correctOptionId: "C" });
    expect(first.questionId).toBe(questionId);
    const keys = (await getVersion(teacher.client, content.versionId)).keys;
    expect(keys).toContainEqual({ questionId, correctOptionId: "C", revision: first.revision });
    const second = await setQuestionKey(teacher.client, questionId, { correctOptionId: "A", revision: first.revision });
    expect(second.revision).toBeGreaterThan(first.revision);
    await expect(
      setQuestionKey(teacher.client, questionId, { correctOptionId: "B", revision: first.revision }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(setQuestionKey(teacher.client, questionId, { correctOptionId: "Z" })).rejects.toMatchObject({ code: "INVALID" });
  });

  it("approves a complete version, and repeating the same opId answers the same", async () => {
    const { teacher, content } = await setup();
    const { revision } = (await getVersion(teacher.client, content.versionId)).version;
    const decision = { revision, opId: randomUUID() };
    const approved = await approveVersion(teacher.client, content.versionId, decision);
    expect(approved).toEqual({ id: content.versionId, approvedRevision: revision });
    expect(await approveVersion(teacher.client, content.versionId, decision)).toEqual(approved);
    expect((await getVersion(teacher.client, content.versionId)).version.approvedRevision).toBe(revision);
  });

  it("refuses to approve an incomplete version", async () => {
    const { teacher, content, exerciseId } = await setup();
    const detail = await getVersion(teacher.client, content.versionId);
    const current = detail.exercises.find((exercise) => exercise.id === exerciseId);
    await updateVersionExercise(teacher.client, exerciseId, { revision: current?.revision ?? 0, body: "", opId: randomUUID() });
    const { revision } = (await getVersion(teacher.client, content.versionId)).version;
    await expect(approveVersion(teacher.client, content.versionId, { revision, opId: randomUUID() })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("rejects a version with reasons, and repeating the same opId answers the same", async () => {
    const { teacher, content } = await setup();
    const { revision } = (await getVersion(teacher.client, content.versionId)).version;
    const rejection = { revision, reasons: ["no_adapta", "confuso"], opId: randomUUID() };
    const rejected = await rejectVersion(teacher.client, content.versionId, rejection);
    expect(await rejectVersion(teacher.client, content.versionId, rejection)).toEqual(rejected);
    const other = { revision, reasons: ["confuso"], opId: rejection.opId };
    await expect(rejectVersion(teacher.client, content.versionId, other)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("answers NOT_FOUND to a user of another institution and changes nothing", async () => {
    const { teacher, content, exerciseId, questionId } = await setup();
    const { teacher: stranger } = await createSchool();
    const before = await getVersion(teacher.client, content.versionId);
    const { version } = before;
    const notFound = { code: "NOT_FOUND" };
    const edit = { revision: 1, opId: randomUUID() };

    const instructions = { ...edit, generalInstructions: "Cambiado" };
    await expect(updateVersionInstructions(stranger.client, version.id, instructions)).rejects.toMatchObject(notFound);
    await expect(updateVersionExercise(stranger.client, exerciseId, { ...edit, body: "Cambiado" })).rejects.toMatchObject(notFound);
    const question = { ...edit, stem: "Cambiada", options: OPTIONS };
    await expect(updateVersionQuestion(stranger.client, questionId, question)).rejects.toMatchObject(notFound);
    await expect(setQuestionKey(stranger.client, questionId, { correctOptionId: "A" })).rejects.toMatchObject(notFound);
    await expect(approveVersion(stranger.client, version.id, edit)).rejects.toMatchObject(notFound);
    await expect(rejectVersion(stranger.client, version.id, { ...edit, reasons: ["confuso"] })).rejects.toMatchObject(notFound);

    expect(await getVersion(teacher.client, version.id)).toEqual(before);
  });
});
