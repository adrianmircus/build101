import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { approveAnswerKey, confirmAnswerKey, editAnswerKey, getAnswerKey } from "@/lib/server/repos/answer-keys";
import { setQuestionKey, updateVersionExercise } from "@/lib/server/repos/version-content";
import { getVersion } from "@/lib/server/repos/versions";
import { createGroup, createSchool } from "../factories";
import { createGazeContent, keyContentOf } from "../factories/generations";

async function setup() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  const content = await createGazeContent(school, group.id);
  const [exerciseId] = content.adapted;
  if (exerciseId === undefined) throw new Error("Falta contenido de prueba.");
  return { ...school, content, exerciseId };
}

describe("repos of answer keys", () => {
  it("has no key until the first edit, and edits the first key without a base", async () => {
    const { teacher, content } = await setup();
    await expect(getAnswerKey(teacher.client, content.versionId)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const edit = { content: keyContentOf(content) };
    const first = await editAnswerKey(teacher.client, content.versionId, edit);
    expect(first.number).toBe(1);
    const key = await getAnswerKey(teacher.client, content.versionId);
    expect(key.current).toMatchObject({ id: first.revisionId, number: 1, source: "edited", content: edit.content });
    expect(key.stale).toBe(false);
  });

  it("edits from a base, and a stale base is CONFLICT", async () => {
    const { teacher, content } = await setup();
    const first = await editAnswerKey(teacher.client, content.versionId, { content: keyContentOf(content) });
    const next = { content: keyContentOf(content, "Otra"), baseRevisionId: first.revisionId };
    const second = await editAnswerKey(teacher.client, content.versionId, next);
    expect(second.number).toBe(2);
    await expect(editAnswerKey(teacher.client, content.versionId, next)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getAnswerKey(teacher.client, content.versionId)).current?.id).toBe(second.revisionId);
  });

  it("confirms the key with the correct options of the day and approves it", async () => {
    const { teacher, content } = await setup();
    for (const questionId of content.questions) await setQuestionKey(teacher.client, questionId, { correctOptionId: "A" });
    const edited = await editAnswerKey(teacher.client, content.versionId, { content: keyContentOf(content) });
    const confirmed = await confirmAnswerKey(teacher.client, content.versionId, edited.revisionId);
    expect(confirmed.number).toBe(2);
    await expect(confirmAnswerKey(teacher.client, content.versionId, edited.revisionId)).rejects.toMatchObject({ code: "CONFLICT" });

    const approved = await approveAnswerKey(teacher.client, content.versionId, confirmed.revisionId);
    expect(approved.approvedRevisionId).toBe(confirmed.revisionId);
    const key = await getAnswerKey(teacher.client, content.versionId);
    expect(key).toMatchObject({ approvedRevisionId: confirmed.revisionId, stale: false });
    expect(await approveAnswerKey(teacher.client, content.versionId, confirmed.revisionId)).toEqual(approved);
  });

  it("turns the key stale when the content changes", async () => {
    const { teacher, content, exerciseId } = await setup();
    await editAnswerKey(teacher.client, content.versionId, { content: keyContentOf(content) });
    const detail = await getVersion(teacher.client, content.versionId);
    const exercise = detail.exercises.find((item) => item.id === exerciseId);
    const changes = { revision: exercise?.revision ?? 0, body: "Texto nuevo", opId: randomUUID() };
    await updateVersionExercise(teacher.client, exerciseId, changes);
    expect((await getAnswerKey(teacher.client, content.versionId)).stale).toBe(true);
  });

  it("answers NOT_FOUND to a user of another institution and changes nothing", async () => {
    const { teacher, content } = await setup();
    const first = await editAnswerKey(teacher.client, content.versionId, { content: keyContentOf(content) });
    const before = await getAnswerKey(teacher.client, content.versionId);
    const { teacher: stranger } = await createSchool();
    const notFound = { code: "NOT_FOUND" };

    await expect(getAnswerKey(stranger.client, content.versionId)).rejects.toMatchObject(notFound);
    const edit = { content: keyContentOf(content, "Ajena"), baseRevisionId: first.revisionId };
    await expect(editAnswerKey(stranger.client, content.versionId, edit)).rejects.toMatchObject(notFound);
    await expect(confirmAnswerKey(stranger.client, content.versionId, first.revisionId)).rejects.toMatchObject(notFound);
    await expect(approveAnswerKey(stranger.client, content.versionId, first.revisionId)).rejects.toMatchObject(notFound);
    expect(await getAnswerKey(teacher.client, content.versionId)).toEqual(before);
  });
});
